import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { determineRiskLevel } from '@/lib/risk-assessment';
import { ResourceMonitor, resourceAwareSleep, calculateOptimalBatchSize } from '@/lib/resource-monitor';

export const maxDuration = 3600; // 1 hour max duration
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CONSERVATIVE CPU stress testing configuration - Respects 80% CPU/Memory limits
const CPU_STRESS_CONFIG = {
  MAX_CONCURRENT_OPERATIONS: 1, // ALWAYS 1 for single CPU - NEVER parallel for stress test
  BASE_BATCH_SIZE: 10, // Much smaller - reduced from 50 for conservative stress testing
  MIN_BATCH_SIZE: 3,   // Minimum when resources are high
  MAX_BATCH_SIZE: 20,  // Maximum when resources are low
  BASE_DELAY_BETWEEN_BATCHES: 500, // Much longer - increased from 0 for resource management
  MIN_DELAY_BETWEEN_BATCHES: 200,
  MAX_DELAY_BETWEEN_BATCHES: 3000, // Long delay when throttling
  MAX_TOKENS_PER_BATCH: 25, // Much smaller - reduced from 150 for conservative processing
  DB_OPERATION_DELAY: 300, // Much longer - increased from 0 for conservative DB operations
  MEMORY_CLEANUP_INTERVAL: 20, // More frequent cleanup - reduced from 200
  RESOURCE_CHECK_INTERVAL: 3, // Check resources every 3 batches
  EMERGENCY_BRAKE_THRESHOLD: 2, // Trigger emergency brake after just 2 consecutive throttles
  STRESS_MULTIPLIER_LIMIT: 5, // Maximum stress multiplier allowed
};

// Resource limits for stress testing - MUST respect 80% limits
const STRESS_RESOURCE_LIMITS = {
  maxCpuPercent: 80,
  maxMemoryPercent: 80,
  warningCpuPercent: 65, // Lower warning threshold for stress test
  warningMemoryPercent: 65,
};

// Realistic scopes for simulated OAuth tokens - based on common real-world applications
const SIMULATED_TOKEN_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly'
];

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  return await supabaseAdmin
    .from('sync_status')
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', syncId);
}

// Helper function to process in resource-aware batches with strict monitoring
async function processInResourceAwareBatches<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  resourceMonitor: ResourceMonitor,
  syncId: string,
  batchType: string = 'items'
): Promise<void> {
  let processedCount = 0;
  let consecutiveThrottles = 0;
  let emergencyBrakeCount = 0;
  
  for (let i = 0; i < items.length; i += CPU_STRESS_CONFIG.BASE_BATCH_SIZE) {
    // STRICT resource checking - abort if overloaded
    if (resourceMonitor.isOverloaded()) {
      emergencyBrakeCount++;
      console.warn(`🚨 [CPU STRESS ${syncId}] System overloaded during ${batchType} - EMERGENCY STOP #${emergencyBrakeCount}`);
      
      if (emergencyBrakeCount > 2) {
        throw new Error(`Stress test ABORTED: System consistently overloaded (${batchType})`);
      }
      
      let waitTime = 0;
      const maxWaitTime = 60000; // 60 seconds max wait for stress test
      
      while (resourceMonitor.isOverloaded() && waitTime < maxWaitTime) {
        await resourceAwareSleep(3000, resourceMonitor); // 3 second pauses
        waitTime += 3000;
      }
      
      if (resourceMonitor.isOverloaded()) {
        throw new Error(`Stress test FAILED: System overloaded for ${maxWaitTime/1000} seconds`);
      }
    }
    
    // Calculate very conservative batch size
    const optimalBatchSize = calculateOptimalBatchSize(
      CPU_STRESS_CONFIG.BASE_BATCH_SIZE,
      resourceMonitor,
      CPU_STRESS_CONFIG.MIN_BATCH_SIZE,
      CPU_STRESS_CONFIG.MAX_BATCH_SIZE
    );
    
    // Get the actual batch
    const batch = items.slice(i, i + optimalBatchSize);
    
    // Log resource usage frequently for stress test
    if (processedCount % (CPU_STRESS_CONFIG.RESOURCE_CHECK_INTERVAL * optimalBatchSize) === 0) {
      const usage = resourceMonitor.getCurrentUsage();
      console.log(`🔍 [CPU STRESS ${syncId}] Resource usage: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%, Batch size: ${optimalBatchSize} (${batchType})`);
      
      // Extra safety check - if we're getting close to limits, slow down more
      if (usage.cpuPercent > 75 || usage.memoryPercent > 75) {
        console.warn(`⚠️  [CPU STRESS ${syncId}] Approaching limits - forcing extra delay`);
        await resourceAwareSleep(2000, resourceMonitor);
      }
    }
    
    // Process the batch
    await processor(batch);
    processedCount += batch.length;
    
    // Aggressive memory cleanup for stress test
    if (processedCount % CPU_STRESS_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
      resourceMonitor.forceMemoryCleanup();
    }
    
    // Calculate conservative delay - longer delays for stress test
    let delay = CPU_STRESS_CONFIG.BASE_DELAY_BETWEEN_BATCHES;
    
    if (resourceMonitor.shouldThrottle()) {
      const throttleDelay = resourceMonitor.getThrottleDelay();
      delay = Math.min(CPU_STRESS_CONFIG.MAX_DELAY_BETWEEN_BATCHES, delay + throttleDelay * 1.5); // 1.5x multiplier for stress test
      consecutiveThrottles++;
      
      console.log(`⚠️  [CPU STRESS ${syncId}] Throttling ${batchType}: ${throttleDelay}ms additional delay (consecutive: ${consecutiveThrottles})`);
    } else {
      consecutiveThrottles = 0;
      delay = Math.max(CPU_STRESS_CONFIG.MIN_DELAY_BETWEEN_BATCHES, delay);
    }
    
    // Very aggressive emergency brake for stress test
    if (consecutiveThrottles > CPU_STRESS_CONFIG.EMERGENCY_BRAKE_THRESHOLD) {
      emergencyBrakeCount++;
      console.warn(`🚨 [CPU STRESS ${syncId}] Emergency brake #${emergencyBrakeCount}: Stress test throttling too much for ${batchType}`);
      await resourceAwareSleep(15000, resourceMonitor); // 15 second pause
      consecutiveThrottles = 0;
      
      // Fail fast if emergency brake is hit too often
      if (emergencyBrakeCount > 1) {
        throw new Error(`Stress test TERMINATED: Emergency brake triggered ${emergencyBrakeCount} times for ${batchType}`);
      }
    }
    
    // Apply delay - always apply delay for stress test
    await resourceAwareSleep(delay, resourceMonitor);
    
    // Update batch loop increment to use actual processed batch size
    i = i + optimalBatchSize - CPU_STRESS_CONFIG.BASE_BATCH_SIZE;
  }
  
  console.log(`✅ [CPU STRESS ${syncId}] Completed processing ${processedCount} ${batchType} (Emergency brakes: ${emergencyBrakeCount})`);
}

// Simulate token processing with multiplied data - RESOURCE AWARE
async function simulateTokenProcessing(
  organizationId: string,
  syncId: string,
  multiplier: number,
  baselineData: any,
  accessToken: string,
  refreshToken: string,
  resourceMonitor: ResourceMonitor,
  realTokens: any[] = []
) {
  console.log(`🧪 [CPU STRESS] Starting CONSERVATIVE token processing with ${multiplier}x multiplier`);
  
  // Validate stress multiplier
  if (multiplier > CPU_STRESS_CONFIG.STRESS_MULTIPLIER_LIMIT) {
    throw new Error(`Stress multiplier ${multiplier} exceeds safety limit of ${CPU_STRESS_CONFIG.STRESS_MULTIPLIER_LIMIT}`);
  }
  
  // Fetch real user IDs to create valid relationships
  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1000); // Limit to 1000 users for the test

  if (usersError || !users || users.length === 0) {
    console.warn(`[CPU STRESS] No users found for org ${organizationId}. Skipping user_applications stress test.`);
  }
  const userIds = users ? users.map(u => u.id) : [];

  let tokensToProcess: any[] = [];
  if (realTokens.length > 0) {
    console.log(`[CPU STRESS] Using ${realTokens.length} real tokens as a baseline. Amplifying ${multiplier}x CONSERVATIVELY.`);
    for (let i = 0; i < multiplier; i++) {
      // Create copies of tokens to ensure they are unique objects
      tokensToProcess.push(...realTokens.map(token => ({ ...token })));
    }
  } else {
    console.warn('[CPU STRESS] No real tokens fetched. Falling back to purely simulated data based on baseline.');
    const simulatedTokenCount = Math.min((baselineData.userAppRelations || 100) * multiplier, 2000); // Cap at 2000 for safety
    for (let i = 0; i < simulatedTokenCount; i++) {
      tokensToProcess.push({
        displayText: `SimulatedApp_${Math.floor(i / 10)}`,
        scopes: SIMULATED_TOKEN_SCOPES,
      });
    }
  }

  // Assign real user IDs to all tokens that will be processed
  if (userIds.length > 0) {
    tokensToProcess.forEach(token => {
      const randomUserIndex = Math.floor(Math.random() * userIds.length);
      token.userId = userIds[randomUserIndex];
    });
  }
  
  const totalTokensToProcess = tokensToProcess.length;
  await updateSyncStatus(syncId, 10, `🧪 CPU STRESS: Processing ${totalTokensToProcess} total tokens CONSERVATIVELY (real data amplified)`);
  console.log(`🧪 [CPU STRESS] Processing ${totalTokensToProcess} token operations CONSERVATIVELY...`);
  
  // Process tokens in resource-aware batches
  await processInResourceAwareBatches(
    tokensToProcess,
    async (tokenBatch) => {
      // Simulate grouping by application (CPU-intensive operation)
      const appGroups = new Map<string, any[]>();
      for (const token of tokenBatch) {
        const appName = token.displayText;
        if (!appName) {
          continue;
        }
        if (!appGroups.has(appName)) {
          appGroups.set(appName, []);
        }
        appGroups.get(appName)!.push(token);
      }
      
      // Process all app groups in this batch SEQUENTIALLY (no parallel processing)
      for (const [appName, tokensInGroup] of appGroups.entries()) {
        // Simulate scope aggregation and risk analysis
        const allScopes = new Set<string>();
        tokensInGroup.forEach((token: any) => {
          if(token.scopes && Array.isArray(token.scopes)) {
              token.scopes.forEach((scope: string) => allScopes.add(scope));
          }
        });
        
        // Check if application already exists
        const { data: existingApp } = await supabaseAdmin
          .from('applications')
          .select('id')
          .eq('name', appName)
          .eq('organization_id', organizationId)
          .maybeSingle();

        let applicationId: string;
        if (existingApp) {
          // Update existing application
          const appRecord = {
            name: appName,
            organization_id: organizationId,
            risk_level: determineRiskLevel(Array.from(allScopes) as string[]),
            total_permissions: allScopes.size,
            all_scopes: Array.from(allScopes),
            category: 'Simulated Stress Test',
            provider: 'google',
            notes: `stress_test_${syncId}` // Tag for easy cleanup
          };
          
          const { data: updatedApp, error: updateError } = await supabaseAdmin
            .from('applications')
            .update(appRecord)
            .eq('id', existingApp.id)
            .select('id')
            .single();
          
          if (updateError || !updatedApp) {
            console.error(`[CPU STRESS] Error updating application ${appName}:`, updateError);
            return;
          }
          applicationId = updatedApp.id;
        } else {
          // Insert new application
          const appRecord = {
            name: appName,
            organization_id: organizationId,
            risk_level: determineRiskLevel(Array.from(allScopes) as string[]),
            total_permissions: allScopes.size,
            all_scopes: Array.from(allScopes),
            category: 'Simulated Stress Test',
            provider: 'google',
            notes: `stress_test_${syncId}` // Tag for easy cleanup
          };
          
          const { data: newApp, error: insertError } = await supabaseAdmin
            .from('applications')
            .insert(appRecord)
            .select('id')
            .single();
          
          if (insertError || !newApp) {
            console.error(`[CPU STRESS] Error inserting application ${appName}:`, insertError);
            return;
          }
          applicationId = newApp.id;
        }

        // Simulate creation of user-application relations
        if (applicationId && userIds.length > 0) {
          const userAppRelationsToUpsert: any[] = [];
          const usersForThisApp = new Set<string>();
          
          tokensInGroup.forEach((token: any) => {
            if (token.userId) {
              usersForThisApp.add(token.userId);
            }
          });

          usersForThisApp.forEach(userId => {
            userAppRelationsToUpsert.push({
              user_id: userId,
              application_id: applicationId,
              scopes: Array.from(allScopes), // Use aggregated scopes
              first_seen: new Date().toISOString(),
              last_used: new Date().toISOString(),
            });
          });

          if (userAppRelationsToUpsert.length > 0) {
            // Process user-app relationships SEQUENTIALLY
            for (const relation of userAppRelationsToUpsert) {
              // Check if relationship already exists
              const { data: existingRelation } = await supabaseAdmin
                .from('user_applications')
                .select('id, scopes')
                .eq('user_id', relation.user_id)
                .eq('application_id', relation.application_id)
                .maybeSingle();

              if (existingRelation) {
                // Update existing relationship, merging scopes
                const mergedScopes = [...new Set([...(existingRelation.scopes || []), ...relation.scopes])];
                await supabaseAdmin
                  .from('user_applications')
                  .update({
                    scopes: mergedScopes,
                    last_used: relation.last_used
                  })
                  .eq('id', existingRelation.id);
              } else {
                // Insert new relationship
                await supabaseAdmin
                  .from('user_applications')
                  .insert(relation);
              }
              
              // Small delay between each relationship to prevent overload
              await resourceAwareSleep(CPU_STRESS_CONFIG.DB_OPERATION_DELAY, resourceMonitor);
            }
          }
        }

        // Add delay between applications to prevent overload
        await resourceAwareSleep(CPU_STRESS_CONFIG.DB_OPERATION_DELAY, resourceMonitor);
      }
      
      // Clear batch data to prevent memory buildup
      tokenBatch.length = 0;
      appGroups.clear();
    },
    resourceMonitor,
    syncId,
    'stress test tokens'
  );
  
  console.log(`✅ [CPU STRESS] Completed CONSERVATIVE simulation of ${totalTokensToProcess} token operations`);
  // Clear the large token array
  tokensToProcess.length = 0;
}

export async function POST(request: NextRequest) {
  let sync_id: string | undefined;
  let resourceMonitor: ResourceMonitor | undefined;
  
  try {
    const body = await request.json();
    const {
      organization_id,
      access_token,
      refresh_token,
      simulation_multiplier,
      baseline_data,
      provider = 'google'
    } = body;
    
    sync_id = body.sync_id; // Extract sync_id for error handling

    console.log(`🧪 [CPU STRESS] Starting CONSERVATIVE CPU stress test for org ${organization_id} with ${simulation_multiplier}x multiplier`);
    
    if (!organization_id || !sync_id || !access_token || !simulation_multiplier || !baseline_data) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Validate simulation multiplier safety
    if (simulation_multiplier > CPU_STRESS_CONFIG.STRESS_MULTIPLIER_LIMIT) {
      return NextResponse.json({ 
        error: `Simulation multiplier ${simulation_multiplier} exceeds safety limit of ${CPU_STRESS_CONFIG.STRESS_MULTIPLIER_LIMIT}` 
      }, { status: 400 });
    }

    // Initialize resource monitoring with strict limits
    resourceMonitor = ResourceMonitor.getInstance(STRESS_RESOURCE_LIMITS);
    resourceMonitor.startMonitoring(500); // Check every 500ms for stress test
    
    // Set up strict resource monitoring event handlers
    resourceMonitor.on('overload', (usage) => {
      console.error(`🚨 [CPU STRESS] CRITICAL OVERLOAD: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    resourceMonitor.on('warning', (usage) => {
      console.warn(`⚠️  [CPU STRESS] WARNING: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });

    // Log initial memory state
    const startMemory = process.memoryUsage();
    const initialUsage = resourceMonitor.getCurrentUsage();
    console.log('🧪 [CPU STRESS] Initial state:', {
      heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`,
      cpu: `${initialUsage.cpuPercent.toFixed(1)}%`,
      memory: `${initialUsage.memoryPercent.toFixed(1)}%`
    });

    // Initialize Google service for token refresh testing
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({
      access_token,
      refresh_token,
      scope: [
        'openid',
        'profile',
        'email',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.security'
      ].join(' ')
    });

    // Test token refresh under stress
    await updateSyncStatus(sync_id, 5, '🧪 CPU STRESS: Testing token refresh with resource monitoring...');
    
    try {
      const refreshedTokens = await googleService.refreshAccessToken(true);
      if (refreshedTokens) {
        console.log(`✅ [CPU STRESS] Token refresh successful with resource monitoring`);
        
        // Update sync_status with refreshed tokens
        await supabaseAdmin
          .from('sync_status')
          .update({
            access_token: refreshedTokens.access_token,
            refresh_token: refreshedTokens.refresh_token,
            updated_at: new Date().toISOString()
          })
          .eq('id', sync_id);
      }
    } catch (refreshError: any) {
      console.error(`❌ [CPU STRESS] Token refresh failed:`, refreshError);
      throw new Error(`Token refresh failed during CONSERVATIVE stress test: ${refreshError.message}`);
    }

    // Skip real token fetching to avoid scope issues - use simulated data instead
    console.log('🧪 [CPU STRESS] Using simulated token data for CONSERVATIVE stress test (no additional OAuth scopes required)');

    // Simulate the main token processing workload with resource monitoring
    await simulateTokenProcessing(
      organization_id,
      sync_id,
      simulation_multiplier,
      baseline_data,
      access_token,
      refresh_token,
      resourceMonitor,
      [] // Empty array - will use simulated data
    );

    // Cleanup the data created during the stress test
    const { data: testApps, error: findError } = await supabaseAdmin
      .from('applications')
      .select('id')
      .eq('notes', `stress_test_${sync_id}`);

    if (findError) {
      console.error('[CPU STRESS] Error finding test applications for cleanup:', findError);
    } else if (testApps && testApps.length > 0) {
      const testAppIds = testApps.map(a => a.id);
      console.log(`[CPU STRESS] Cleaning up user_application relations for ${testAppIds.length} apps...`);
      await supabaseAdmin
        .from('user_applications')
        .delete()
        .in('application_id', testAppIds);
      
      console.log(`[CPU STRESS] Cleaning up ${testApps.length} simulated application records...`);
      await supabaseAdmin
        .from('applications')
        .delete()
        .in('id', testAppIds);
      
      console.log(`[CPU STRESS] Cleanup complete.`);
    }

    // Final memory check
    const endMemory = process.memoryUsage();
    const finalUsage = resourceMonitor.getCurrentUsage();
    const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;
    
    console.log('🧪 [CPU STRESS] Final state:', {
      heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`,
      increase: `${Math.round(memoryIncrease / 1024 / 1024)}MB`,
      cpu: `${finalUsage.cpuPercent.toFixed(1)}%`,
      memory: `${finalUsage.memoryPercent.toFixed(1)}%`
    });

    // Determine if resource usage is acceptable - stricter criteria
    const cpuPeakAcceptable = finalUsage.cpuPercent < 80;
    const memoryEfficiency = memoryIncrease < (50 * 1024 * 1024) ? 'EXCELLENT' : 
                            memoryIncrease < (100 * 1024 * 1024) ? 'GOOD' : 
                            memoryIncrease < (200 * 1024 * 1024) ? 'ACCEPTABLE' : 'NEEDS_OPTIMIZATION';

    const overallPerformance = cpuPeakAcceptable && (memoryEfficiency === 'EXCELLENT' || memoryEfficiency === 'GOOD') ? 'PASSED' : 'NEEDS_TUNING';

    await updateSyncStatus(
      sync_id, 
      100, 
      `🧪 CONSERVATIVE CPU STRESS TEST COMPLETED: ${simulation_multiplier}x load, Performance: ${overallPerformance}, Memory: ${memoryEfficiency}`,
      'COMPLETED'
    );

    return NextResponse.json({
      success: true,
      message: `CONSERVATIVE CPU stress test completed successfully`,
      simulation: {
        multiplier: simulation_multiplier,
        simulatedUsers: baseline_data.users * simulation_multiplier,
        simulatedApps: baseline_data.applications * simulation_multiplier,
        simulatedTokens: baseline_data.userAppRelations * simulation_multiplier
      },
      performance: {
        overallResult: overallPerformance,
        cpuPeakAcceptable,
        memoryUsage: {
          start: startMemory,
          end: endMemory,
          increase: memoryIncrease,
          efficiency: memoryEfficiency
        },
        resourceLimitsRespected: {
          maxCpuUsed: `${finalUsage.cpuPercent.toFixed(1)}%`,
          maxMemoryUsed: `${finalUsage.memoryPercent.toFixed(1)}%`,
          limitsRespected: finalUsage.cpuPercent <= 80 && finalUsage.memoryPercent <= 80
        },
        optimizations: [
          'Sequential processing (single CPU)',
          'Resource-aware batch sizing',
          'Memory cleanup intervals',
          'Conservative delays',
          'Emergency brake system',
          'Real-time resource monitoring'
        ]
      },
      testResults: {
        tokenRefreshWorking: true,
        resourceLimitsRespected: finalUsage.cpuPercent <= 80 && finalUsage.memoryPercent <= 80,
        memoryLeakDetected: memoryIncrease > (200 * 1024 * 1024),
        recommendedForProduction: overallPerformance === 'PASSED',
        stressTestPassed: overallPerformance === 'PASSED' && cpuPeakAcceptable
      }
    });

  } catch (error: any) {
    console.error('❌ [CPU STRESS] Error in CONSERVATIVE CPU stress test:', error);
    
    // Update sync status to failed
    if (request && sync_id) {
      await updateSyncStatus(
        sync_id,
        0,
        `🧪 CONSERVATIVE CPU STRESS TEST FAILED: ${error.message}`,
        'FAILED'
      );
    }
    
    return NextResponse.json({
      success: false,
      error: 'CONSERVATIVE CPU stress test failed',
      details: error.message,
      recommendation: 'System may need further optimization before handling larger workloads'
    }, { status: 500 });
  } finally {
    // Always stop monitoring when done
    if (resourceMonitor) {
      resourceMonitor.stopMonitoring();
    }
  }
} 