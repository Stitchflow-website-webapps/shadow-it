import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { determineRiskLevel } from '@/lib/risk-assessment';

export const maxDuration = 3600; // 1 hour max duration
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CPU-optimized configuration for stress testing
const CPU_STRESS_CONFIG = {
  MAX_CONCURRENT_OPERATIONS: 3, // Increased from 1 for parallel processing
  BATCH_SIZE: 50, // Increased from 25 for bigger batches
  DELAY_BETWEEN_BATCHES: 0, // Removed delay for maximum stress
  MAX_TOKENS_PER_BATCH: 150, // Increased from 75 for bigger batches
  DB_OPERATION_DELAY: 0, // Removed delay for maximum stress
  MEMORY_CLEANUP_INTERVAL: 200, // Less frequent cleanup for more stress
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to force garbage collection and cleanup
function forceMemoryCleanup() {
  if (global.gc) {
    global.gc();
  }
}

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

// Simulate token processing with multiplied data
async function simulateTokenProcessing(
  organizationId: string,
  syncId: string,
  multiplier: number,
  baselineData: any,
  accessToken: string,
  refreshToken: string,
  realTokens: any[] = []
) {
  console.log(`🧪 [CPU STRESS] Starting token processing with ${multiplier}x multiplier`);
  
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
    console.log(`[CPU STRESS] Using ${realTokens.length} real tokens as a baseline. Amplifying ${multiplier}x.`);
    for (let i = 0; i < multiplier; i++) {
      // Create copies of tokens to ensure they are unique objects
      tokensToProcess.push(...realTokens.map(token => ({ ...token })));
    }
  } else {
    console.warn('[CPU STRESS] No real tokens fetched. Falling back to purely simulated data based on baseline.');
    const simulatedTokenCount = (baselineData.userAppRelations || 100) * multiplier;
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
  await updateSyncStatus(syncId, 10, `🧪 CPU STRESS: Processing ${totalTokensToProcess} total tokens (real data amplified)`);
  console.log(`🧪 [CPU STRESS] Processing ${totalTokensToProcess} token operations...`);
  
  const tokenBatchSize = CPU_STRESS_CONFIG.MAX_TOKENS_PER_BATCH;
  const totalBatches = Math.ceil(totalTokensToProcess / tokenBatchSize);
  
  // Process batches in parallel for maximum stress
  const concurrency = CPU_STRESS_CONFIG.MAX_CONCURRENT_OPERATIONS;
  const batchPromises: Promise<void>[] = [];
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += concurrency) {
    // Create a group of concurrent batches
    const concurrentBatches: Promise<void>[] = [];
    
    for (let i = 0; i < concurrency && (batchIndex + i) < totalBatches; i++) {
      const currentBatchIndex = batchIndex + i;
      const batchStart = currentBatchIndex * tokenBatchSize;
      const batchEnd = Math.min(batchStart + tokenBatchSize, totalTokensToProcess);
      const tokenBatch = tokensToProcess.slice(batchStart, batchEnd);
      
      // Create a promise for processing this batch
      const batchPromise = (async () => {
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
        
        // Process all app groups in this batch in parallel
        const appProcessingPromises = Array.from(appGroups.entries()).map(async ([appName, tokensInGroup]) => {
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
              // Process user-app relationships in parallel too
              const relationPromises = userAppRelationsToUpsert.map(async (relation) => {
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
              });
              
              await Promise.all(relationPromises);
            }
          }

          // No delay for maximum stress
          if (CPU_STRESS_CONFIG.DB_OPERATION_DELAY > 0) {
            await sleep(CPU_STRESS_CONFIG.DB_OPERATION_DELAY);
          }
        });
        
        // Wait for all apps in this batch to be processed
        await Promise.all(appProcessingPromises);
        
        // Clear batch data to prevent memory buildup
        tokenBatch.length = 0;
        appGroups.clear();
      })();
      
      concurrentBatches.push(batchPromise);
    }
    
    // Wait for this group of concurrent batches to complete
    await Promise.all(concurrentBatches);
    
    // Update progress
    const progress = 10 + Math.floor(((batchIndex + concurrency) / totalBatches) * 80);
    await updateSyncStatus(
      syncId, 
      Math.min(progress, 90), 
      `🧪 CPU STRESS: Processed batches ${batchIndex + 1}-${Math.min(batchIndex + concurrency, totalBatches)}/${totalBatches} (parallel processing)`
    );
    
    // Memory cleanup every N operations
    if (batchIndex % CPU_STRESS_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
      forceMemoryCleanup();
    }
    
    // No delay between batch groups for maximum stress
    if (CPU_STRESS_CONFIG.DELAY_BETWEEN_BATCHES > 0) {
      await sleep(CPU_STRESS_CONFIG.DELAY_BETWEEN_BATCHES);
    }
  }
  
  console.log(`✅ [CPU STRESS] Completed simulation of ${totalTokensToProcess} token operations`);
  // Clear the large token array
  tokensToProcess.length = 0;
}

export async function POST(request: NextRequest) {
  let sync_id: string | undefined;
  
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

    console.log(`🧪 [CPU STRESS] Starting CPU stress test for org ${organization_id} with ${simulation_multiplier}x multiplier`);
    
    if (!organization_id || !sync_id || !access_token || !simulation_multiplier || !baseline_data) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Log initial memory state
    const startMemory = process.memoryUsage();
    console.log('🧪 [CPU STRESS] Initial memory:', {
      heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`
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
    await updateSyncStatus(sync_id, 5, '🧪 CPU STRESS: Testing token refresh under load...');
    
    try {
      const refreshedTokens = await googleService.refreshAccessToken(true);
      if (refreshedTokens) {
        console.log(`✅ [CPU STRESS] Token refresh successful under stress conditions`);
        
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
      throw new Error(`Token refresh failed during stress test: ${refreshError.message}`);
    }

    // Skip real token fetching to avoid scope issues - use simulated data instead
    console.log('🧪 [CPU STRESS] Using simulated token data for stress test (no additional OAuth scopes required)');

    // Simulate the main token processing workload
    await simulateTokenProcessing(
      organization_id,
      sync_id,
      simulation_multiplier,
      baseline_data,
      access_token,
      refresh_token,
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
    const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;
    
    console.log('🧪 [CPU STRESS] Final memory:', {
      heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`,
      increase: `${Math.round(memoryIncrease / 1024 / 1024)}MB`
    });

    // Determine if memory usage is acceptable
    const memoryEfficiency = memoryIncrease < (100 * 1024 * 1024) ? 'EXCELLENT' : 
                            memoryIncrease < (200 * 1024 * 1024) ? 'GOOD' : 
                            memoryIncrease < (500 * 1024 * 1024) ? 'ACCEPTABLE' : 'NEEDS_OPTIMIZATION';

    await updateSyncStatus(
      sync_id, 
      100, 
      `🧪 CPU STRESS TEST COMPLETED: ${simulation_multiplier}x load, memory efficiency: ${memoryEfficiency}`,
      'COMPLETED'
    );

    return NextResponse.json({
      success: true,
      message: `CPU stress test completed successfully`,
      simulation: {
        multiplier: simulation_multiplier,
        simulatedUsers: baseline_data.users * simulation_multiplier,
        simulatedApps: baseline_data.applications * simulation_multiplier,
        simulatedTokens: baseline_data.userAppRelations * simulation_multiplier
      },
      performance: {
        memoryUsage: {
          start: startMemory,
          end: endMemory,
          increase: memoryIncrease,
          efficiency: memoryEfficiency
        },
        cpuOptimizations: [
          'Sequential processing (single CPU)',
          'Controlled batch sizes',
          'Memory cleanup intervals',
          'Optimized delays',
          'Token refresh under load'
        ]
      },
      testResults: {
        tokenRefreshWorking: true,
        memoryLeakDetected: memoryIncrease > (500 * 1024 * 1024),
        cpuOptimizationEffective: memoryEfficiency !== 'NEEDS_OPTIMIZATION',
        recommendedForProduction: memoryEfficiency === 'EXCELLENT' || memoryEfficiency === 'GOOD'
      }
    });

  } catch (error: any) {
    console.error('❌ [CPU STRESS] Error in CPU stress test:', error);
    
    // Update sync status to failed
    if (request && sync_id) {
      await updateSyncStatus(
        sync_id,
        0,
        `🧪 CPU STRESS TEST FAILED: ${error.message}`,
        'FAILED'
      );
    }
    
    return NextResponse.json({
      success: false,
      error: 'CPU stress test failed',
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
} 