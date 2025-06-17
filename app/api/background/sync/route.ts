import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor, CircuitBreaker, resourceAwareSleep } from '@/lib/resource-monitor';

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

// Resource-aware configuration - Balanced for single CPU with controlled endpoint parallelism
const SYNC_CONFIG = {
  MAX_CPU_PERCENT: 80,
  MAX_MEMORY_PERCENT: 80,
  WARNING_CPU_PERCENT: 70,
  WARNING_MEMORY_PERCENT: 70,
  BASE_DELAY_BETWEEN_ENDPOINTS: 2000, // 2 seconds base delay
  MAX_DELAY_BETWEEN_ENDPOINTS: 10000, // 10 seconds max delay
  MEMORY_CLEANUP_INTERVAL: 30000, // 30 seconds
  // NEW: Controlled endpoint parallelism for larger organizations
  ENABLE_ENDPOINT_PARALLELISM: true, // Enable parallel endpoint processing
  MAX_PARALLEL_ENDPOINTS: 2, // Maximum 2 endpoints in parallel for single CPU
  SEQUENTIAL_FALLBACK_THRESHOLD: 75, // CPU/Memory % to fall back to sequential
};

// Helper function to determine if we should use parallel processing
function shouldUseParallelProcessing(resourceMonitor: ResourceMonitor): boolean {
  if (!SYNC_CONFIG.ENABLE_ENDPOINT_PARALLELISM) return false;
  
  const usage = resourceMonitor.getCurrentUsage();
  const maxUsage = Math.max(usage.cpuPercent, usage.memoryPercent);
  
  return maxUsage < SYNC_CONFIG.SEQUENTIAL_FALLBACK_THRESHOLD;
}

// Helper function to process endpoints with adaptive parallelism
async function processEndpointsWithAdaptiveParallelism(
  endpoints: string[],
  requestData: any,
  headers: Record<string, string>,
  baseUrl: string,
  resourceMonitor: ResourceMonitor,
  circuitBreaker: CircuitBreaker,
  syncId: string
): Promise<void> {
  console.log(`[MAIN SYNC ${syncId}] Processing ${endpoints.length} endpoints with adaptive parallelism`);
  
  for (let i = 0; i < endpoints.length; i += SYNC_CONFIG.MAX_PARALLEL_ENDPOINTS) {
    // Check resource usage before each batch
    if (resourceMonitor.isOverloaded()) {
      console.warn(`🚨 [MAIN SYNC ${syncId}] System overloaded, waiting for recovery...`);
      
      let waitTime = 0;
      const maxWaitTime = 30000; // 30 seconds max wait
      
      while (resourceMonitor.isOverloaded() && waitTime < maxWaitTime) {
        await resourceAwareSleep(1000, resourceMonitor);
        waitTime += 1000;
      }
      
      if (resourceMonitor.isOverloaded()) {
        throw new Error('System resources remain overloaded after 30 seconds');
      }
    }
    
    // Determine processing mode based on current resources
    const useParallel = shouldUseParallelProcessing(resourceMonitor);
    const currentUsage = resourceMonitor.getCurrentUsage();
    
    console.log(`🔍 [MAIN SYNC ${syncId}] Resource usage: CPU: ${currentUsage.cpuPercent.toFixed(1)}%, Memory: ${currentUsage.memoryPercent.toFixed(1)}%, Mode: ${useParallel ? 'PARALLEL' : 'SEQUENTIAL'}`);
    
    if (useParallel && endpoints.length > 1) {
      // Process endpoints in parallel (up to MAX_PARALLEL_ENDPOINTS)
      const parallelBatch = endpoints.slice(i, i + SYNC_CONFIG.MAX_PARALLEL_ENDPOINTS);
      
      console.log(`⚡ [MAIN SYNC ${syncId}] Processing ${parallelBatch.length} endpoints in parallel`);
      
      await Promise.all(parallelBatch.map(async (endpoint) => {
        try {
          await processEndpoint(endpoint, requestData, headers, baseUrl, circuitBreaker, syncId);
        } catch (endpointError) {
          console.error(`[MAIN SYNC ${syncId}] Error in parallel endpoint ${endpoint}:`, endpointError);
          throw endpointError; // Still throw to maintain error handling
        }
      }));
    } else {
      // Process endpoints sequentially
      const sequentialBatch = endpoints.slice(i, i + SYNC_CONFIG.MAX_PARALLEL_ENDPOINTS);
      
      console.log(`🔄 [MAIN SYNC ${syncId}] Processing ${sequentialBatch.length} endpoints sequentially`);
      
      for (const endpoint of sequentialBatch) {
        try {
          await processEndpoint(endpoint, requestData, headers, baseUrl, circuitBreaker, syncId);
          
          // Add delay between sequential endpoints
          if (endpoint !== sequentialBatch[sequentialBatch.length - 1]) {
            await resourceAwareSleep(SYNC_CONFIG.BASE_DELAY_BETWEEN_ENDPOINTS / 2, resourceMonitor);
          }
        } catch (endpointError) {
          console.error(`[MAIN SYNC ${syncId}] Error in sequential endpoint ${endpoint}:`, endpointError);
          throw endpointError;
        }
      }
    }
    
    // Force memory cleanup between batches
    resourceMonitor.forceMemoryCleanup();
    
    // Resource-aware delay between endpoint batches (not for last batch)
    if (i + SYNC_CONFIG.MAX_PARALLEL_ENDPOINTS < endpoints.length) {
      console.log(`[MAIN SYNC ${syncId}] Waiting before next endpoint batch with resource-aware delay...`);
      
      // Calculate delay based on resource usage
      const delayUsage = resourceMonitor.getCurrentUsage();
      let baseDelay = SYNC_CONFIG.BASE_DELAY_BETWEEN_ENDPOINTS;
      
      // Increase delay if resources are high
      if (delayUsage.cpuPercent > 60 || delayUsage.memoryPercent > 60) {
        baseDelay = Math.min(SYNC_CONFIG.MAX_DELAY_BETWEEN_ENDPOINTS, baseDelay * 1.5);
      }
      
      await resourceAwareSleep(baseDelay, resourceMonitor);
    }
  }
}

// Helper function to process a single endpoint
async function processEndpoint(
  endpoint: string,
  requestData: any,
  headers: Record<string, string>,
  baseUrl: string,
  circuitBreaker: CircuitBreaker,
  syncId: string
): Promise<void> {
  console.log(`[MAIN SYNC ${syncId}] Processing endpoint: ${endpoint}`);
  
  // Try first with the prefixed URL
  const prefixedUrl = `${baseUrl}/${endpoint}`;
  let response;
  
  // Execute with circuit breaker protection
  await circuitBreaker.execute(async () => {
    try {
      response = await fetch(prefixedUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData),
      });
    } catch (fetchError) {
      console.log(`[MAIN SYNC ${syncId}] Error with ${prefixedUrl}, trying direct URL...`);
      // If the first attempt fails, try without the prefix
      const directUrl = `${baseUrl}/${endpoint}`;
      response = await fetch(directUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData),
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error(`[MAIN SYNC ${syncId}] Error from ${endpoint}:`, error);
      throw new Error(`${endpoint} failed: ${error}`);
    }
  });

  console.log(`[MAIN SYNC ${syncId}] ✅ Successfully completed ${endpoint}`);
}

export async function POST(request: NextRequest) {
  let requestData;
  let resourceMonitor: ResourceMonitor | undefined;
  let circuitBreaker: CircuitBreaker;

  try {
    // Parse the request data once and store it for reuse
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      access_token, 
      refresh_token,
      provider 
    } = requestData;

    // Initialize resource monitoring
    resourceMonitor = ResourceMonitor.getInstance({
      maxCpuPercent: SYNC_CONFIG.MAX_CPU_PERCENT,
      maxMemoryPercent: SYNC_CONFIG.MAX_MEMORY_PERCENT,
      warningCpuPercent: SYNC_CONFIG.WARNING_CPU_PERCENT,
      warningMemoryPercent: SYNC_CONFIG.WARNING_MEMORY_PERCENT
    });
    
    // Start monitoring resources
    resourceMonitor.startMonitoring(1000); // Check every second
    
    // Initialize circuit breaker
    circuitBreaker = new CircuitBreaker(3, 120000, 15000); // 3 failures, 2min timeout, 15s monitoring
    
    // Set up resource monitoring event handlers
    resourceMonitor.on('overload', (usage) => {
      console.warn(`🚨 RESOURCE OVERLOAD: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    resourceMonitor.on('warning', (usage) => {
      console.warn(`⚠️  RESOURCE WARNING: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });

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

    // Initial resource check
    const initialUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [MAIN SYNC] Initial resource usage: CPU: ${initialUsage.cpuPercent.toFixed(1)}%, Memory: ${initialUsage.memoryPercent.toFixed(1)}%`);

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
          // 'api/background/sync/relations', - handled by tokens endpoint
          // 'api/background/sync/categorize' - handled by tokens endpoint
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
    
    console.log(`[MAIN SYNC] Using base URL: ${baseUrl}`);

    // Prepare headers with test mode flags
    const syncHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (isTestMode) {
      syncHeaders['X-Test-Mode'] = 'true';
    }
    if (skipEmail) {
      syncHeaders['X-Skip-Email'] = 'true';
    }

    // Process endpoints with adaptive parallelism
    await processEndpointsWithAdaptiveParallelism(
      endpoints, 
      {
        organization_id,
        sync_id,
        access_token,
        refresh_token,
        provider
      }, 
      syncHeaders, 
      baseUrl, 
      resourceMonitor, 
      circuitBreaker, 
      sync_id
    );

    // Final resource check and cleanup
    const finalUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [MAIN SYNC] Final resource usage: CPU: ${finalUsage.cpuPercent.toFixed(1)}%, Memory: ${finalUsage.memoryPercent.toFixed(1)}%`);
    
    // Wait additional time for any background processes to complete with resource awareness
    console.log('[MAIN SYNC] Main sync completed, waiting for background processes with resource monitoring...');
    await resourceAwareSleep(5000, resourceMonitor); // 5 second delay with throttling
    
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
      
    // Wait a bit longer to ensure all background processes finish with resource monitoring
    await resourceAwareSleep(5000, resourceMonitor); // Another 5 second delay with throttling

    // Mark sync as completed
    const completedMessage = isTestMode 
      ? `🧪 TEST: ${provider} data sync completed (Resource-Aware)`
      : `${provider} data sync completed (Resource-Aware)`;
      
    await supabaseAdmin
      .from('sync_status')
      .update({
        progress: 100,
        status: 'COMPLETED',
        message: completedMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', sync_id);

    return NextResponse.json({ 
      success: true,
      testMode: isTestMode,
      emailsSkipped: skipEmail,
      resourceUsage: {
        initial: initialUsage,
        final: finalUsage,
        circuitBreakerState: circuitBreaker.getState()
      }
    });
  } catch (error) {
    console.error('[MAIN SYNC] ❌ Background sync error:', error);
    
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
  } finally {
    // Always stop monitoring when done
    if (resourceMonitor) {
      resourceMonitor.stopMonitoring();
    }
  }
} 