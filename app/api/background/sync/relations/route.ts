import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor, processInBatchesWithResourceControl } from '@/lib/resource-monitor';

// Configuration optimized for 1 CPU + 2GB RAM - Balanced for speed vs stability
const PROCESSING_CONFIG = {
  BATCH_SIZE: 25, // Increased from 15 for better throughput
  DELAY_BETWEEN_BATCHES: 100, // Reduced from 150ms for faster processing
  DB_OPERATION_DELAY: 50, // Reduced from 75ms for faster DB operations
  MAX_RELATIONS_PER_BATCH: 50, // Increased from 30 for better throughput
  MEMORY_CLEANUP_INTERVAL: 100, // Increased from 75 for better speed
};

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to process in controlled batches
async function processInBatches<T>(
  items: T[], 
  processor: (batch: T[]) => Promise<void>,
  batchSize: number = PROCESSING_CONFIG.BATCH_SIZE,
  delay: number = PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
    
    // Add delay between batches to prevent overwhelming the system
    if (i + batchSize < items.length) {
      await sleep(delay);
    }
  }
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

// Helper function to force garbage collection and memory cleanup
const forceMemoryCleanup = () => {
  if (global.gc) {
    global.gc();
  }
  // Clear any lingering references
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 1500 * 1024 * 1024) { // If using > 1.5GB heap
      console.log(`Memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, forcing cleanup`);
      if (global.gc) global.gc();
    }
  }
};

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  let requestData;
  try {
    console.log('Starting relations processing with resource monitoring');
    
    requestData = await request.json();
    const { 
      organization_id, 
      sync_id, 
      userAppRelations, 
      appMap 
    } = requestData;

    console.log(`[Relations API ${sync_id}] Received request`);

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
      await processRelations(organization_id, sync_id, relations, apps);
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
    
    console.log(`[Relations API ${sync_id}] Relations processing completed successfully`);
    return NextResponse.json({ 
      message: 'Relations processing completed successfully',
      syncId: sync_id 
    });

  } catch (error: any) {
    const sync_id_for_error = requestData?.sync_id;
    console.error(`[Relations API ${sync_id_for_error || 'unknown'}] Error:`, error);
    // processRelations is responsible for updating sync_status to FAILED.
    return NextResponse.json(
      { error: 'Failed to process relations', details: error.message },
      { status: 500 }
    );
  }
}

async function processRelations(
  organization_id: string, 
  sync_id: string, 
  userAppRelations: Array<{appName: string, userId: string, userEmail: string, token: any}>,
  appMap: Array<{appName: string, appId: string}>
) {
  const monitor = ResourceMonitor.getInstance();
  
  try {
    console.log(`[Relations ${sync_id}] Starting relations processing for organization: ${organization_id}`);
    
    // Log initial resource usage
    monitor.logResourceUsage(`Relations ${sync_id} START`);
    
    // Create a mapping of app names to IDs
    const appIdMap = new Map<string, string>();
    appMap.forEach(app => {
      appIdMap.set(app.appName, app.appId);
    });
    
    await updateSyncStatus(sync_id, 85, `Processing ${userAppRelations.length} user-application relations with resource monitoring`);
    
    // **NEW: Fetch existing relationships with resource-aware batching**
    console.log(`[Relations ${sync_id}] Fetching existing relationships with resource-aware batching`);
    
    const existingRelMap = new Map<string, {id: string, scopes: string[]}>();
    
    // Get app IDs for the current organization
    const appIds = appMap.map(app => app.appId);
    
    // Only fetch if there are app IDs to look for
    if (appIds.length > 0) {
      // **FIXED: Use smaller, parallel batches to avoid 'fetch failed' errors on large datasets, as seen in test-cron-google**
      const fetchBatchSize = 100; // Reduced batch size to prevent URI too long errors
      const fetchPromises = [];

      for (let i = 0; i < appIds.length; i += fetchBatchSize) {
        const batchAppIds = appIds.slice(i, i + fetchBatchSize);
        
        // Add the promise to the array
        fetchPromises.push(
          (async () => {
            // Wait for resources before each fetch
            await monitor.waitForResources();
            
            const { data, error } = await supabaseAdmin
              .from('user_applications')
              .select('id, user_id, application_id, scopes')
              .in('application_id', batchAppIds);
            
            if (error) {
              console.error(`[Relations ${sync_id}] Error fetching existing relationships for batch starting at index ${i}:`, error);
              throw error; // Rethrow to fail the Promise.all
            }
            return data;
          })()
        );
      }
      
      try {
        // Execute all fetches in parallel
        const results = await Promise.all(fetchPromises);
        
        // Process results
        for (const existingRelations of results) {
          if (existingRelations && existingRelations.length > 0) {
            existingRelations.forEach(rel => {
              const key = `${rel.user_id}-${rel.application_id}`;
              existingRelMap.set(key, {
                id: rel.id,
                scopes: rel.scopes || []
              });
            });
          }
        }
      } catch (relError) {
        console.error('Error fetching existing relationships in parallel:', relError);
        throw relError;
      }
    }
    
    console.log(`[Relations ${sync_id}] Found ${existingRelMap.size} existing relationships`);
    
    // **NEW: Group relations by user-app pair with resource-aware processing**
    const relationsByUserAppPair = new Map<string, {
      userId: string,
      appId: string,
      appName: string,
      scopes: Set<string>
    }>();
    
    console.log(`[Relations ${sync_id}] Processing ${userAppRelations.length} relations with resource-aware grouping`);
    
    // Process relations in resource-aware batches
    await processInBatchesWithResourceControl(
      userAppRelations,
      async (relationBatch) => {
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
      `Relations ${sync_id} GROUPING`,
      50, // Conservative batch size
      100 // Base delay
    );
    
    // Prepare batches for processing with resource awareness
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
    
    await updateSyncStatus(sync_id, 90, `Saving user-application relationships with resource monitoring`);
    
    // **NEW: Handle updates with resource-aware processing**
    if (relationsToUpdate.length > 0) {
      console.log(`[Relations ${sync_id}] Processing ${relationsToUpdate.length} updates with resource-aware batching`);
      
      await processInBatchesWithResourceControl(
        relationsToUpdate,
        async (updateBatch) => {
          try {
            const { error: updateError } = await supabaseAdmin
              .from('user_applications')
              .upsert(updateBatch, {
                onConflict: 'user_id,application_id',
                ignoreDuplicates: true
              });
                  
            if (updateError) {
              console.error(`[Relations ${sync_id}] Error updating batch:`, updateError);
            }
          } catch (updateError) {
            console.error(`[Relations ${sync_id}] Error updating user-application relationships batch:`, updateError);
          }
        },
        `Relations ${sync_id} UPDATES`,
        20, // Conservative batch size for database operations
        150 // Base delay
      );
    }
    
    // **NEW: Process inserts with resource-aware processing**
    let insertSuccess = true;
    if (relationsToInsert.length > 0) {
      console.log(`[Relations ${sync_id}] Processing ${relationsToInsert.length} inserts with resource-aware batching`);
      
      await processInBatchesWithResourceControl(
        relationsToInsert,
        async (insertBatch) => {
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
            }
          } catch (insertError) {
            console.error(`[Relations ${sync_id}] Error inserting user-application relationships batch:`, insertError);
            insertSuccess = false;
          }
        },
        `Relations ${sync_id} INSERTS`,
        20, // Conservative batch size for database operations
        150 // Base delay
      );
    }
    
    // Clear memory by removing large objects
    relationsByUserAppPair.clear();
    existingRelMap.clear();
    
    // Log final resource usage
    monitor.logResourceUsage(`Relations ${sync_id} COMPLETE`);
    
    // Finalize (89% progress to allow tokens step to complete)
    let finalMessage = `User-application relationships processed successfully with resource optimization.`;
    if (!insertSuccess) {
      finalMessage = `Sync completed with some issues - User and application data was saved, but some relationships may be incomplete`;
    }
    
    await updateSyncStatus(
      sync_id, 
      89, // Adjusted progress: Tokens step will take it to 90%
      finalMessage,
      'IN_PROGRESS' // Changed from COMPLETED
    );
    
    console.log(`[Relations ${sync_id}] Relations processing completed successfully (within processRelations)`);
    
  } catch (error: any) {
    console.error(`[Relations ${sync_id}] Error in relations processing:`, error);
    
    // Log resource usage on error
    monitor.logResourceUsage(`Relations ${sync_id} ERROR`);
    
    // Even if there was an error, mark as completed with partial data
    await updateSyncStatus( // Ensure await
      sync_id, 
      88, // Adjusted progress for failure at this stage
      `Relations processing failed with resource monitoring: ${error.message}`,
      'FAILED' // Status is FAILED
    );
    
    // Don't rethrow the error - we've handled it
    throw error; // Rethrow so POST handler can return 500
  }
} 