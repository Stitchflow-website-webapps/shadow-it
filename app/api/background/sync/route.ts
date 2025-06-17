import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor } from '@/lib/resource-monitor';

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: NextRequest) {
  let requestData;
  try {
    // Initialize resource monitor with conservative limits for 1 CPU + 2GB RAM
    const monitor = ResourceMonitor.getInstance({
      maxHeapUsageMB: 1600,     // 80% of 2GB
      maxRSSUsageMB: 1600,      // 80% of 2GB
      maxConcurrency: 2,        // Conservative for 1 CPU
      emergencyThresholdMB: 1700 // More aggressive emergency threshold (85% instead of 90%)
    });

    // Parse the request data once and store it for reuse
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      provider 
    } = requestData;

    // Check for test mode headers
    const isTestMode = request.headers.get('X-Test-Mode') === 'true';
    const skipEmail = request.headers.get('X-Skip-Email') === 'true';
    
    if (isTestMode) {
      console.log(`🧪 [MAIN SYNC] Running in TEST MODE for sync_id: ${sync_id}`);
    }

    if (!organization_id || !sync_id || !access_token || !provider) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Log initial resource usage
    monitor.logResourceUsage('MAIN SYNC START');

    // Update sync status to indicate progress
    const statusMessage = isTestMode 
      ? `🧪 TEST: Starting ${provider} data sync with resource monitoring...`
      : `Starting ${provider} data sync with resource monitoring...`;
      
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 10,
        message: statusMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);

    // Determine which sync endpoints to call based on provider
    const endpoints = provider === 'google' 
      ? [
          'api/background/sync/users',
          'api/background/sync/tokens',
          // 'api/background/sync/relations',
          // 'api/background/sync/categorize'
        ]
      : [
          'api/background/sync/microsoft'
        ];

    // Extract the host from the URL
    const urlObj = new URL(request.url);
    const host = urlObj.hostname === 'localhost' ? urlObj.host : urlObj.hostname;
    
    // Force HTTP for localhost development, otherwise use HTTPS
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`Using base URL: ${baseUrl}`);

    // Prepare request data
    const requestPayload = {
      organization_id,
      sync_id,
      access_token,
      refresh_token,
      provider
    };

    // Prepare headers with test mode flags
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (isTestMode) {
      headers['X-Test-Mode'] = 'true';
    }
    if (skipEmail) {
      headers['X-Skip-Email'] = 'true';
    }

    // **NEW: Enable parallel processing with resource-aware concurrency**
    const enableParallel = process.env.ENABLE_PARALLEL_SYNC !== 'false' && endpoints.length > 1;
    
    if (enableParallel && provider === 'google') {
      console.log(`🚀 [MAIN SYNC] Starting parallel processing of ${endpoints.length} endpoints`);
      
      // For Google sync, we can run users and tokens in parallel since tokens waits for users anyway
      // But we'll use adaptive concurrency based on current resource usage
      const concurrency = monitor.getOptimalConcurrency();
      
      console.log(`📊 [MAIN SYNC] Using concurrency level: ${concurrency}`);
      
      // **NEW: Additional safety check - ensure we have enough memory headroom**
      const currentUsage = monitor.getCurrentUsage();
      const memoryRatio = Math.max(currentUsage.heapUsed / 1600, currentUsage.rss / 1600);
      
      if (memoryRatio > 0.6) {
        console.log(`⚠️ [MAIN SYNC] Memory usage already at ${(memoryRatio * 100).toFixed(1)}% - forcing sequential processing`);
        await processEndpointsSequentially(endpoints, baseUrl, headers, requestPayload, monitor);
      } else if (concurrency >= 2 && endpoints.length >= 2) {
        // Run first two endpoints (users and tokens) in parallel
        const parallelEndpoints = endpoints.slice(0, 2);
        const sequentialEndpoints = endpoints.slice(2);
        
        try {
          // Wait for resources before starting parallel operations
          await monitor.waitForResources();
          
          const parallelPromises = parallelEndpoints.map(async (endpoint) => {
            const url = `${baseUrl}/${endpoint}`;
            console.log(`🔄 [PARALLEL] Starting ${endpoint}...`);
            
            try {
              const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestPayload),
              });

              if (!response.ok) {
                const error = await response.text();
                console.error(`❌ [PARALLEL] Error from ${endpoint}:`, error);
                throw new Error(`${endpoint} failed: ${error}`);
              }

              console.log(`✅ [PARALLEL] Successfully completed ${endpoint}`);
              return { endpoint, success: true };
            } catch (error) {
              console.error(`❌ [PARALLEL] Error processing ${endpoint}:`, error);
              throw error;
            }
          });

          // Wait for both parallel operations to complete
          const results = await Promise.allSettled(parallelPromises);
          
          // Check if any parallel operations failed
          const failures = results.filter(result => result.status === 'rejected');
          if (failures.length > 0) {
            console.error(`❌ [PARALLEL] ${failures.length} parallel operations failed`);
            throw new Error(`Parallel sync operations failed: ${failures.map(f => f.status === 'rejected' ? f.reason.message : 'unknown').join(', ')}`);
          }

          console.log(`✅ [PARALLEL] All parallel operations completed successfully`);
          
          // Log resource usage after parallel operations
          monitor.logResourceUsage('PARALLEL SYNC COMPLETE');
          
          // Continue with any remaining sequential endpoints
          for (const endpoint of sequentialEndpoints) {
            await monitor.waitForResources();
            
            const url = `${baseUrl}/${endpoint}`;
            console.log(`🔄 [SEQUENTIAL] Processing ${endpoint}...`);
            
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestPayload),
            });

            if (!response.ok) {
              const error = await response.text();
              console.error(`❌ [SEQUENTIAL] Error from ${endpoint}:`, error);
              throw new Error(`${endpoint} failed: ${error}`);
            }

            console.log(`✅ [SEQUENTIAL] Successfully completed ${endpoint}`);
            
            // Small delay between sequential operations
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (parallelError) {
          console.error(`❌ [PARALLEL] Parallel sync failed, falling back to sequential:`, parallelError);
          
          // Fallback to sequential processing
          console.log(`🔄 [FALLBACK] Switching to sequential processing...`);
          await processEndpointsSequentially(endpoints, baseUrl, headers, requestPayload, monitor);
        }
      } else {
        // Resource constraints - use sequential processing
        console.log(`📉 [MAIN SYNC] Resource constraints detected, using sequential processing`);
        await processEndpointsSequentially(endpoints, baseUrl, headers, requestPayload, monitor);
      }
    } else {
      // Sequential processing (fallback or single endpoint)
      console.log(`🔄 [MAIN SYNC] Using sequential processing`);
      await processEndpointsSequentially(endpoints, baseUrl, headers, requestPayload, monitor);
    }

    // Wait additional time for any background processes to complete
    console.log('Main sync completed, waiting for background processes...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
    
    // Update sync status to 95% while we wait for final background tasks
    const finalizeMessage = isTestMode 
      ? '🧪 TEST: Finalizing data synchronization...'
      : 'Finalizing data synchronization...';
      
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 95,
        message: finalizeMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);
      
    // Wait a bit longer to ensure all background processes finish
    await new Promise(resolve => setTimeout(resolve, 5000)); // Another 5 second delay

    // Mark sync as completed
    const completedMessage = isTestMode 
      ? `🧪 TEST: ${provider} data sync completed`
      : `${provider} data sync completed`;
      
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 100,
        status: 'COMPLETED',
        message: completedMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);

    // Log final resource usage
    monitor.logResourceUsage('MAIN SYNC COMPLETE');

    return NextResponse.json({ 
      success: true,
      testMode: isTestMode,
      emailsSkipped: skipEmail,
      parallelProcessing: enableParallel,
      finalResourceUsage: monitor.getCurrentUsage()
    });
  } catch (error) {
    console.error('Background sync error:', error);
    
    // Update sync status to failed
    if (requestData && requestData.sync_id) {
      const isTestMode = request.headers.get('X-Test-Mode') === 'true';
      const failedMessage = isTestMode 
        ? `🧪 TEST FAILED: ${(error as Error).message}`
        : `Sync failed: ${(error as Error).message}`;
        
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: failedMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', requestData.sync_id);
    }
    
    return NextResponse.json(
      { error: 'Failed to sync data' },
      { status: 500 }
    );
  }
}

// Helper function for sequential processing with resource monitoring
async function processEndpointsSequentially(
  endpoints: string[],
  baseUrl: string,
  headers: Record<string, string>,
  requestPayload: any,
  monitor: ResourceMonitor
): Promise<void> {
  for (const endpoint of endpoints) {
    try {
      // Wait for resources before each endpoint
      await monitor.waitForResources();
      
      // Try first with the /tools/shadow-it-scan prefix as per next.config.js assetPrefix
      const prefixedUrl = `${baseUrl}/${endpoint}`;
      console.log(`🔄 [SEQUENTIAL] Calling ${prefixedUrl}...`);
      
      let response;
      try {
        response = await fetch(prefixedUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload),
        });
      } catch (fetchError) {
        console.log(`Error with ${prefixedUrl}, trying without /tools/shadow-it-scan/ prefix...`);
        // If the first attempt fails, try without the prefix
        const directUrl = `${baseUrl}/${endpoint}`;
        console.log(`Calling ${directUrl}...`);
        response = await fetch(directUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload),
        });
      }

      if (!response.ok) {
        const error = await response.text();
        console.error(`Error from ${endpoint}:`, error);
        throw new Error(`${endpoint} failed: ${error}`);
      }

      console.log(`✅ [SEQUENTIAL] Successfully completed ${endpoint}`);
      
      // Log resource usage after each endpoint
      monitor.logResourceUsage(`SEQUENTIAL ${endpoint.split('/').pop()?.toUpperCase()}`);
      
      // Add a delay between endpoints to ensure database operations complete
      // Longer delay if resources are constrained
      const usage = monitor.getCurrentUsage();
      const memoryRatio = Math.max(usage.heapUsed / 1600, usage.rss / 1600);
      const delay = memoryRatio > 0.7 ? 3000 : memoryRatio > 0.5 ? 2000 : 1000;
      
      if (endpoint.includes('users')) {
        console.log(`Waiting ${delay}ms for database to process user data...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`Error processing ${endpoint}:`, error);
      throw error;
    }
  }
} 