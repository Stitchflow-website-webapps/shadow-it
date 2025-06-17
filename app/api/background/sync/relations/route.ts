import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor, resourceAwareSleep, calculateOptimalBatchSize } from '@/lib/resource-monitor';

// Resource-aware configuration - Balanced settings for single CPU with controlled parallelism
const PROCESSING_CONFIG = {
  BASE_BATCH_SIZE: 15, // Base batch size for relations processing
  MIN_BATCH_SIZE: 3,   // Minimum batch size when resources are high
  MAX_BATCH_SIZE: 40,  // Maximum batch size when resources are low
  BASE_DELAY_BETWEEN_BATCHES: 100, // Reduced from 150 for better throughput
  MIN_DELAY_BETWEEN_BATCHES: 50, // Reduced delay
  MAX_DELAY_BETWEEN_BATCHES: 1500, // Maximum delay when throttling
  DB_OPERATION_DELAY: 75, // DB operation delay
  MAX_RELATIONS_PER_BATCH: 35, // Maximum relations per batch
  MEMORY_CLEANUP_INTERVAL: 60, // Memory cleanup frequency
  RESOURCE_CHECK_INTERVAL: 8, // Check resources every 8 batches
  EMERGENCY_BRAKE_THRESHOLD: 4, // Trigger emergency brake after 4 consecutive throttles
  FETCH_BATCH_SIZE: 300, // Fetch batch size for database queries
  // NEW: Concurrency settings for single CPU
  MAX_CONCURRENT_OPERATIONS: 2, // Conservative for relations processing on single CPU
  MIN_CONCURRENT_OPERATIONS: 1, // Minimum when resources are high
  ADAPTIVE_CONCURRENCY: true,   // Enable dynamic concurrency adjustment
  CONCURRENCY_REDUCTION_THRESHOLD: 70, // CPU/Memory % to reduce concurrency
  CONCURRENCY_INCREASE_THRESHOLD: 45,  // CPU/Memory % to allow more concurrency
};

// Resource limits - Conservative for single CPU
const RESOURCE_LIMITS = {
  maxCpuPercent: 80,
  maxMemoryPercent: 80,
  warningCpuPercent: 70,
  warningMemoryPercent: 70,
};

// Helper function to calculate optimal concurrency based on resources
function calculateOptimalConcurrency(resourceMonitor: ResourceMonitor): number {
  const usage = resourceMonitor.getCurrentUsage();
  const maxUsage = Math.max(usage.cpuPercent, usage.memoryPercent);
  
  if (maxUsage > PROCESSING_CONFIG.CONCURRENCY_REDUCTION_THRESHOLD) {
    return PROCESSING_CONFIG.MIN_CONCURRENT_OPERATIONS; // Drop to 1 when high usage
  } else if (maxUsage < PROCESSING_CONFIG.CONCURRENCY_INCREASE_THRESHOLD) {
    return PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS; // Allow max when low usage
  } else {
    // Linear scaling between min and max based on resource usage
    const usageRatio = (maxUsage - PROCESSING_CONFIG.CONCURRENCY_INCREASE_THRESHOLD) / 
                      (PROCESSING_CONFIG.CONCURRENCY_REDUCTION_THRESHOLD - PROCESSING_CONFIG.CONCURRENCY_INCREASE_THRESHOLD);
    const concurrencyRange = PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS - PROCESSING_CONFIG.MIN_CONCURRENT_OPERATIONS;
    return Math.max(PROCESSING_CONFIG.MIN_CONCURRENT_OPERATIONS, 
                   PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS - Math.floor(usageRatio * concurrencyRange));
  }
}

// Helper function to process in resource-aware parallel batches
async function processInResourceAwareParallelBatches<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  resourceMonitor: ResourceMonitor,
  syncId: string,
  batchType: string = 'items'
): Promise<void> {
  let processedCount = 0;
  let consecutiveThrottles = 0;
  let emergencyBrakeCount = 0;
  
  // Split items into work chunks
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += PROCESSING_CONFIG.BASE_BATCH_SIZE) {
    const optimalBatchSize = calculateOptimalBatchSize(
      PROCESSING_CONFIG.BASE_BATCH_SIZE,
      resourceMonitor,
      PROCESSING_CONFIG.MIN_BATCH_SIZE,
      PROCESSING_CONFIG.MAX_BATCH_SIZE
    );
    chunks.push(items.slice(i, i + optimalBatchSize));
  }
  
  console.log(`🔄 [Relations ${syncId}] Processing ${chunks.length} chunks of ${batchType} with adaptive parallelism`);
  
  // Process chunks with controlled parallelism
  for (let i = 0; i < chunks.length; i += PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS) {
    // Check if system is overloaded
    if (resourceMonitor.isOverloaded()) {
      console.warn(`🚨 [Relations ${syncId}] System overloaded while processing ${batchType}, waiting for recovery...`);
      
      let waitTime = 0;
      const maxWaitTime = 45000; // 45 seconds max wait
      
      while (resourceMonitor.isOverloaded() && waitTime < maxWaitTime) {
        await resourceAwareSleep(2000, resourceMonitor);
        waitTime += 2000;
      }
      
      if (resourceMonitor.isOverloaded()) {
        throw new Error(`System resources remain critically high after ${maxWaitTime/1000} seconds while processing ${batchType}`);
      }
    }
    
    // Calculate optimal concurrency for this batch
    const optimalConcurrency = PROCESSING_CONFIG.ADAPTIVE_CONCURRENCY ? 
      calculateOptimalConcurrency(resourceMonitor) : 
      PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS;
    
    // Get the parallel batch (up to optimal concurrency)
    const parallelBatch = chunks.slice(i, i + optimalConcurrency);
    
    // Log resource usage and concurrency
    if (processedCount % (PROCESSING_CONFIG.RESOURCE_CHECK_INTERVAL * PROCESSING_CONFIG.BASE_BATCH_SIZE) === 0) {
      const usage = resourceMonitor.getCurrentUsage();
      console.log(`🔍 [Relations ${syncId}] Resource usage: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%, Concurrency: ${parallelBatch.length} (${batchType})`);
    }
    
    // Process batches in parallel with resource monitoring
    try {
      await Promise.all(parallelBatch.map(async (chunk) => {
        try {
          await processor(chunk);
          processedCount += chunk.length;
        } catch (chunkError) {
          console.error(`[Relations ${syncId}] Error processing ${batchType} chunk:`, chunkError);
          // Continue with other chunks
        }
      }));
    } catch (parallelError) {
      console.error(`[Relations ${syncId}] Error in parallel ${batchType} processing:`, parallelError);
      // Continue with next set of chunks
    }
    
    // Memory cleanup
    if (processedCount % PROCESSING_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
      resourceMonitor.forceMemoryCleanup();
    }
    
    // Calculate appropriate delay
    let delay = PROCESSING_CONFIG.BASE_DELAY_BETWEEN_BATCHES;
    
    if (resourceMonitor.shouldThrottle()) {
      const throttleDelay = resourceMonitor.getThrottleDelay();
      delay = Math.min(PROCESSING_CONFIG.MAX_DELAY_BETWEEN_BATCHES, delay + throttleDelay);
      consecutiveThrottles++;
      
      console.log(`⚠️  [Relations ${syncId}] Throttling ${batchType}: ${throttleDelay}ms additional delay (consecutive: ${consecutiveThrottles})`);
    } else {
      consecutiveThrottles = 0;
      delay = Math.max(PROCESSING_CONFIG.MIN_DELAY_BETWEEN_BATCHES, delay);
    }
    
    // Emergency brake if too many consecutive throttles
    if (consecutiveThrottles > PROCESSING_CONFIG.EMERGENCY_BRAKE_THRESHOLD) {
      emergencyBrakeCount++;
      console.warn(`🚨 [Relations ${syncId}] Emergency brake #${emergencyBrakeCount}: Too many consecutive throttles for ${batchType}, forcing extended pause`);
      await resourceAwareSleep(10000, resourceMonitor); // 10 second pause
      consecutiveThrottles = 0;
      
      // If we hit emergency brake too many times, something is wrong
      if (emergencyBrakeCount > 2) {
        throw new Error(`Emergency brake triggered ${emergencyBrakeCount} times for ${batchType} - system may be overloaded`);
      }
    }
    
    // Apply delay if not the last parallel batch
    if (i + optimalConcurrency < chunks.length) {
      await resourceAwareSleep(delay, resourceMonitor);
    }
  }
  
  console.log(`✅ [Relations ${syncId}] Completed parallel processing of ${processedCount} ${batchType} (Emergency brakes: ${emergencyBrakeCount})`);
}

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  try {
    const { error } = await supabaseAdmin
      .from('sync_status')
      .update({
        status,
        progress,
        message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', syncId);
      
    if (error) {
      console.error(`Error updating sync status: ${error.message}`);
    }
    
    return { success: !error };
  } catch (err) {
    console.error('Unexpected error in updateSyncStatus:', err);
    return { success: false };
  }
}

// Helper function to extract scopes from a token
function extractScopesFromToken(token: any): string[] {
  // If token is undefined or null, return empty array
  if (!token) return [];
  
  let scopes = new Set<string>();
  
  // Add scopes from the token if available
  if (token.scopes && Array.isArray(token.scopes)) {
    token.scopes.forEach((s: string) => scopes.add(s));
  }
  
  // Check scope_data field
  if (token.scopeData && Array.isArray(token.scopeData)) {
    token.scopeData.forEach((sd: any) => {
      if (sd.scope) scopes.add(sd.scope);
      if (sd.value) scopes.add(sd.value);
    });
  }
  
  // Check raw scope string if available
  if (token.scope && typeof token.scope === 'string') {
    token.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
  }
  
  // Some scopes might come from a permissions field
  if (token.permissions && Array.isArray(token.permissions)) {
    const scopesFromPermissions = token.permissions.map((p: any) => p.scope || p.value || p).filter(Boolean);
    if (scopesFromPermissions.length > 0) {
      scopesFromPermissions.forEach((s: string) => scopes.add(s));
    }
  }
  
  // If we have any scope-like fields, try to extract them
  const potentialScopeFields = ['scope_string', 'oauth_scopes', 'accessScopes'];
  for (const field of potentialScopeFields) {
    if (token[field] && typeof token[field] === 'string' && token[field].includes('://')) {
      const extractedScopes = token[field].split(/\s+/);
      extractedScopes.forEach((s: string) => scopes.add(s));
    }
  }

  // If no scopes were found, add a placeholder
  if (scopes.size === 0) {
    scopes.add('unknown_scope');
  }
  
  return Array.from(scopes);
}

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  let requestData;
  let resourceMonitor: ResourceMonitor | undefined;
  
  try {
    console.log('[Relations API] Starting relations processing with resource monitoring');
    
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      userAppRelations, 
      appMap 
    } = requestData;

    console.log(`[Relations API ${sync_id}] Received request`);

    // Initialize resource monitoring
    resourceMonitor = ResourceMonitor.getInstance(RESOURCE_LIMITS);
    resourceMonitor.startMonitoring(1000); // Check every second
    
    // Set up resource monitoring event handlers
    resourceMonitor.on('overload', (usage) => {
      console.warn(`🚨 [Relations ${sync_id}] RESOURCE OVERLOAD: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    resourceMonitor.on('warning', (usage) => {
      console.warn(`⚠️  [Relations ${sync_id}] RESOURCE WARNING: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    // Log initial resource state
    const initialUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Relations ${sync_id}] Initial resource usage: CPU: ${initialUsage.cpuPercent.toFixed(1)}%, Memory: ${initialUsage.memoryPercent.toFixed(1)}%`);

    // Validate required fields
    if (!organization_id || !sync_id) {
      console.error(`[Relations API ${sync_id}] Missing organization_id or sync_id`);
      return NextResponse.json(
        { error: 'Missing organization_id or sync_id' },
        { status: 400 }
      );
    }

    // Check for optional fields - if missing, we'll use empty arrays
    const relations = userAppRelations || [];
    const apps = appMap || [];

    console.log(`[Relations API ${sync_id}] Processing ${relations.length} relations and ${apps.length} apps with resource monitoring`);

    // Only process if we have data
    if (relations.length > 0 && apps.length > 0) {
      await processRelations(organization_id, sync_id, relations, apps, resourceMonitor);
    } else {
      // If no data to process, just update the status
      console.log(`[Relations API ${sync_id}] No relations or apps to process for sync ${sync_id}`);
      
      await updateSyncStatus(
        sync_id, 
        89, // Consistent progress point indicating this step is done
        `Relations processing skipped - no data provided`,
        'IN_PROGRESS' // Keep IN_PROGRESS as this is not the final overall step
      );
    }
    
    // Log final resource state
    const finalUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Relations ${sync_id}] Final resource usage: CPU: ${finalUsage.cpuPercent.toFixed(1)}%, Memory: ${finalUsage.memoryPercent.toFixed(1)}%`);
    
    console.log(`[Relations API ${sync_id}] Relations processing completed successfully`);
    return NextResponse.json({ 
      message: 'Relations processing completed successfully',
      syncId: sync_id,
      resourceUsage: {
        initial: initialUsage,
        final: finalUsage
      }
    });

  } catch (error: any) {
    const sync_id_for_error = requestData?.sync_id;
    console.error(`[Relations API ${sync_id_for_error || 'unknown'}] Error:`, error);
    // processRelations is responsible for updating sync_status to FAILED.
    return NextResponse.json(
      { error: 'Failed to process relations', details: error.message },
      { status: 500 }
    );
  } finally {
    // Always stop monitoring when done
    if (resourceMonitor) {
      resourceMonitor.stopMonitoring();
    }
  }
}

async function processRelations(
  organization_id: string, 
  sync_id: string, 
  userAppRelations: Array<{appName: string, userId: string, userEmail: string, token: any}>,
  appMap: Array<{appName: string, appId: string}>,
  resourceMonitor: ResourceMonitor
) {
  try {
    console.log(`[Relations ${sync_id}] Starting relations processing for organization: ${organization_id} with resource monitoring`);
    
    // Create a mapping of app names to IDs
    const appIdMap = new Map<string, string>();
    appMap.forEach(app => {
      appIdMap.set(app.appName, app.appId);
    });
    
    await updateSyncStatus(sync_id, 85, `Processing ${userAppRelations.length} user-application relations with resource monitoring`);
    
    // First, get all existing relationships with scopes in resource-aware batches
    console.log(`[Relations ${sync_id}] Fetching existing relationships with resource monitoring`);
    
    const existingRelMap = new Map<string, {id: string, scopes: string[]}>();
    let offset = 0;
    
    while (true) {
      // Check resource usage before fetching
      if (resourceMonitor.isOverloaded()) {
        console.warn(`🚨 [Relations ${sync_id}] System overloaded during fetch, waiting...`);
        let waitTime = 0;
        while (resourceMonitor.isOverloaded() && waitTime < 30000) {
          await resourceAwareSleep(2000, resourceMonitor);
          waitTime += 2000;
        }
      }
      
      const { data: existingRelations, error: relError } = await supabaseAdmin
        .from('user_applications')
        .select('id, user_id, application_id, scopes')
        .range(offset, offset + PROCESSING_CONFIG.FETCH_BATCH_SIZE - 1);
      
      if (relError) {
        console.error('[Relations] Error fetching existing relationships:', relError);
        throw relError;
      }
      
      if (!existingRelations || existingRelations.length === 0) {
        break; // No more data
      }
      
      // Add to our map
      existingRelations.forEach(rel => {
        const key = `${rel.user_id}-${rel.application_id}`;
        existingRelMap.set(key, {
          id: rel.id,
          scopes: rel.scopes || []
        });
      });
      
      // If we got less than the batch size, we're done
      if (existingRelations.length < PROCESSING_CONFIG.FETCH_BATCH_SIZE) {
        break;
      }
      
      offset += PROCESSING_CONFIG.FETCH_BATCH_SIZE;
      
      // Force memory cleanup after every few fetches and add delay
      if (offset % (PROCESSING_CONFIG.FETCH_BATCH_SIZE * 3) === 0) {
        resourceMonitor.forceMemoryCleanup();
        await resourceAwareSleep(PROCESSING_CONFIG.DB_OPERATION_DELAY, resourceMonitor);
      }
    }
    
    console.log(`[Relations ${sync_id}] Found ${existingRelMap.size} existing relationships`);
    
    // Group relations by user-app pair to combine scopes more efficiently
    const relationsByUserAppPair = new Map<string, {
      userId: string,
      appId: string,
      appName: string,
      scopes: Set<string>
    }>();
    
    // Process relations in resource-aware parallel batches to prevent memory overload
    console.log(`[Relations ${sync_id}] Processing ${userAppRelations.length} relations with resource monitoring`);
    
    await processInResourceAwareParallelBatches(
      userAppRelations,
      async (relationBatch: Array<{appName: string, userId: string, userEmail: string, token: any}>) => {
        for (const relation of relationBatch) {
          const appId = appIdMap.get(relation.appName);
          if (!appId) {
            console.warn(`No application ID found for ${relation.appName}`);
            continue;
          }
          
          // Extract scopes from this specific token
          const userScopes = extractScopesFromToken(relation.token);
          
          const relationKey = `${relation.userId}-${appId}`;
          
          if (!relationsByUserAppPair.has(relationKey)) {
            relationsByUserAppPair.set(relationKey, {
              userId: relation.userId,
              appId: appId,
              appName: relation.appName,
              scopes: new Set(userScopes)
            });
          } else {
            // Add scopes to existing relation
            const existingScopes = relationsByUserAppPair.get(relationKey)!.scopes;
            userScopes.forEach(scope => existingScopes.add(scope));
          }
        }
      },
      resourceMonitor,
      sync_id,
      'user-app relations'
    );
    
    // Prepare batches for processing
    const relationsToUpdate: any[] = [];
    const relationsToInsert: any[] = [];
    
    // Process the grouped relations
    for (const [relationKey, relationData] of relationsByUserAppPair.entries()) {
      const { userId, appId, scopes } = relationData;
      const scopesArray = Array.from(scopes);
      
      const existingRel = existingRelMap.get(relationKey);
          
      if (existingRel) {
        // For existing relationships, merge with existing scopes
        const mergedScopes = [...new Set([...existingRel.scopes, ...scopesArray])];
        
        relationsToUpdate.push({
          id: existingRel.id,
          user_id: userId,
          application_id: appId,
          scopes: mergedScopes,
          updated_at: new Date().toISOString()
        });
      } else {
        relationsToInsert.push({
          user_id: userId,
          application_id: appId,
          scopes: scopesArray,
          updated_at: new Date().toISOString()
        });
      }
    }
    
    console.log(`[Relations ${sync_id}] Processing ${relationsToUpdate.length} updates and ${relationsToInsert.length} inserts with resource monitoring`);
    
    await updateSyncStatus(sync_id, 90, `Saving user-application relationships (Resource-Aware)`);
    
    // Handle updates in resource-aware parallel batches
    if (relationsToUpdate.length > 0) {
      await processInResourceAwareParallelBatches(
        relationsToUpdate,
        async (updateBatch: any[]) => {
          try {
            const { error: updateError } = await supabaseAdmin
              .from('user_applications')
              .upsert(updateBatch, {
                onConflict: 'user_id,application_id',
                ignoreDuplicates: true
              });
                  
            if (updateError) {
              console.error(`[Relations ${sync_id}] Error updating batch:`, updateError);
              // Continue processing other batches instead of failing completely
            }
          } catch (updateError) {
            console.error(`[Relations ${sync_id}] Error updating user-application relationships batch:`, updateError);
            // Continue processing other batches
          }
        },
        resourceMonitor,
        sync_id,
        'relationship updates'
      );
    }
    
    // Process inserts in resource-aware parallel batches
    let insertSuccess = true;
    if (relationsToInsert.length > 0) {
      await processInResourceAwareParallelBatches(
        relationsToInsert,
        async (insertBatch: any[]) => {
          try {
            const { error: insertError } = await supabaseAdmin
              .from('user_applications')
              .upsert(insertBatch, { 
                onConflict: 'user_id,application_id',
                ignoreDuplicates: true 
              });
                  
            if (insertError) {
              console.error(`[Relations ${sync_id}] Error inserting batch:`, insertError);
              insertSuccess = false;
              // Continue processing other batches
            }
          } catch (insertError) {
            console.error(`[Relations ${sync_id}] Error inserting user-application relationships batch:`, insertError);
            insertSuccess = false;
            // Continue processing other batches
          }
        },
        resourceMonitor,
        sync_id,
        'relationship inserts'
      );
    }
    
    // Clear memory by removing large objects
    relationsByUserAppPair.clear();
    existingRelMap.clear();
    
    // Finalize (89% progress to allow tokens step to complete)
    let finalMessage = `User-application relationships processed successfully (Resource-Aware).`;
    if (!insertSuccess) {
      finalMessage = `Sync completed with some issues - User and application data was saved, but some relationships may be incomplete (Resource-Aware)`;
    }
    
    await updateSyncStatus(
      sync_id, 
      89, // Adjusted progress: Tokens step will take it to 90%
      finalMessage,
      'IN_PROGRESS' // Changed from COMPLETED
    );
    
    console.log(`[Relations ${sync_id}] Relations processing completed successfully with resource monitoring`);
    
  } catch (error: any) {
    console.error(`[Relations ${sync_id}] Error in relations processing:`, error);
    
    // Even if there was an error, mark as completed with partial data
    await updateSyncStatus( // Ensure await
      sync_id, 
      88, // Adjusted progress for failure at this stage
      `Relations processing failed: ${error.message}`,
      'FAILED' // Status is FAILED
    );
    
    // Don't rethrow the error - we've handled it
    throw error; // Rethrow so POST handler can return 500
  }
} 