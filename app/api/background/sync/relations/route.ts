import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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
  try {
    console.log('Starting relations processing');
    
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

    console.log(`[Relations API ${sync_id}] Processing ${relations.length} relations and ${apps.length} apps for processing`);

    // Send immediate response
    // const response = NextResponse.json({ message: 'Relations processing started' });
    
    // Only process if we have data
    if (relations.length > 0 && apps.length > 0) {
      // Process in the background
      // processRelations(organization_id, sync_id, relations, apps)
      // .catch(async (error) => {
      // console.error('Relations processing failed:', error);
      // await updateSyncStatus(
      // sync_id,
      // -1,
      // `Relations processing failed: ${error.message}`,
      // 'FAILED'
      // );
      // });
      await processRelations(organization_id, sync_id, relations, apps);
    } else {
      // If no data to process, just update the status
      console.log(`[Relations API ${sync_id}] No relations or apps to process for sync ${sync_id}`);
      
      // Still mark as completed since this is expected in the flow
      // updateSyncStatus(
      // sync_id, 
      // 100, 
      // `Relations processing completed - no data to process`,
      // 'COMPLETED'
      // ).catch(err => {
      // console.error('Error updating sync status:', err);
      // });
      await updateSyncStatus(
        sync_id, 
        89, // Consistent progress point indicating this step is done
        `Relations processing skipped - no data provided`,
        'IN_PROGRESS' // Keep IN_PROGRESS as this is not the final overall step
      );
    }
    
    // return response;
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
  try {
    console.log(`[Relations ${sync_id}] Starting relations processing for organization: ${organization_id}`);
    
    // Create a mapping of app names to IDs
    const appIdMap = new Map<string, string>();
    appMap.forEach(app => {
      appIdMap.set(app.appName, app.appId);
    });
    
    await updateSyncStatus(sync_id, 85, `Processing ${userAppRelations.length} user-application relations`);
    
    // First, get all existing relationships with scopes
    const { data: existingRelations, error: relError } = await supabaseAdmin
      .from('user_applications')
      .select('id, user_id, application_id, scopes');
    
    if (relError) {
      console.error('Error fetching existing relationships:', relError);
      throw relError;
    }
    
    // Create a map for quick lookup
    const existingRelMap = new Map<string, {id: string, scopes: string[]}>(); 
    if (existingRelations) {
      existingRelations.forEach(rel => {
        const key = `${rel.user_id}-${rel.application_id}`;
        existingRelMap.set(key, {
          id: rel.id,
          scopes: rel.scopes || []
        });
      });
    }
    
    // Group relations by user-app pair to combine scopes more efficiently
    const relationsByUserAppPair = new Map<string, {
      userId: string,
      appId: string,
      appName: string,
      scopes: Set<string>
    }>();
    
    // Process each relationship, grouping by user-app pair and combining scopes
    for (const relation of userAppRelations) {
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
    
    console.log(`[Relations ${sync_id}] Processing ${relationsToUpdate.length} updates and ${relationsToInsert.length} inserts`);
    
    await updateSyncStatus(sync_id, 90, `Saving user-application relationships`);
    
    // Handle updates first
    if (relationsToUpdate.length > 0) {
      try {
        const batchSize = 50;
        for (let i = 0; i < relationsToUpdate.length; i += batchSize) {
          const batch = relationsToUpdate.slice(i, i + batchSize);
          const { error: updateError } = await supabaseAdmin
            .from('user_applications')
            .upsert(batch, {
              onConflict: 'user_id,application_id',
              ignoreDuplicates: true
            });
                
          if (updateError) {
            console.error(`Error updating batch ${i / batchSize + 1}:`, updateError);
          }
        }
      } catch (updateError) {
        console.error('Error updating user-application relationships:', updateError);
      }
    }
    
    // Process inserts in smaller batches
    let insertSuccess = true;
    if (relationsToInsert.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < relationsToInsert.length; i += batchSize) {
        const batch = relationsToInsert.slice(i, i + batchSize);
        try {
          const { error: insertError } = await supabaseAdmin
            .from('user_applications')
            .upsert(batch, { 
              onConflict: 'user_id,application_id',
              ignoreDuplicates: true 
            });
                
          if (insertError) {
            console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
            insertSuccess = false;
          }
        } catch (insertError) {
          console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
          insertSuccess = false;
        }
      }
    }
    
    // Finalize (100% progress)
    let finalMessage = `User-application relationships processed.`;
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