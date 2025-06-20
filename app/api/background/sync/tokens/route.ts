import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';
import { ResourceMonitor, processInBatchesWithResourceControl, processConcurrentlyWithResourceControl } from '@/lib/resource-monitor';
import crypto from 'crypto';

// Configuration optimized for 1 CPU + 2GB RAM - Balanced for speed vs stability
const PROCESSING_CONFIG = {
  MAX_CONCURRENT_OPERATIONS: 2, // Sequential processing only for single CPU
  BATCH_SIZE: 25, // Increased from 15 for better throughput
  DELAY_BETWEEN_BATCHES: 100, // Reduced from 150ms for faster processing
  MAX_TOKENS_PER_BATCH: 75, // Increased from 50 for better throughput
  DB_OPERATION_DELAY: 50, // Reduced from 75ms for faster DB operations
  MEMORY_CLEANUP_INTERVAL: 150, // Less frequent cleanup (from 100) for better speed
};

// **NEW: Emergency memory management for huge organizations**
const EMERGENCY_LIMITS = {
  MAX_TOKENS_IN_MEMORY: 10000, // Hard limit on tokens loaded at once
  MAX_APPS_IN_MEMORY: 2000,    // Hard limit on applications processed at once
  MAX_RELATIONS_IN_MEMORY: 15000, // Hard limit on relations in memory
  FORCE_CLEANUP_THRESHOLD: 1400,  // Force cleanup at 1.4GB (87.5% of 1.6GB limit)
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

// Helper function to wait for users with exponential backoff
async function waitForUsers(organization_id: string, sync_id: string, maxAttempts = 5): Promise<any[]> {
  let attempt = 1;
  let delay = 2000; // Start with 2 seconds

  while (attempt <= maxAttempts) {
    console.log(`[Tokens ${sync_id}] Checking for users attempt ${attempt}/${maxAttempts}`);
    
    const { data: fetchedUsers, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, google_user_id, email')
      .eq('organization_id', organization_id);

    if (userError) {
      console.error(`[Tokens ${sync_id}] Error fetching users:`, userError);
      throw userError;
    }

    if (fetchedUsers && fetchedUsers.length > 0) {
      console.log(`[Tokens ${sync_id}] Found ${fetchedUsers.length} users on attempt ${attempt}`);
      return fetchedUsers;
    }

    // Check sync status to see if user sync failed
    const { data: syncStatus } = await supabaseAdmin
      .from('sync_status')
      .select('status, message')
      .eq('id', sync_id)
      .single();

    if (syncStatus?.status === 'FAILED') {
      throw new Error(`User sync failed: ${syncStatus.message}`);
    }

    console.log(`[Tokens ${sync_id}] No users found yet, waiting ${delay/1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Exponential backoff with max of 10 seconds
    delay = Math.min(delay * 2, 10000);
    attempt++;
  }

  throw new Error('Timeout waiting for users to be processed');
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

async function sendSyncCompletedEmail(userEmail: string, syncId?: string, skipEmail: boolean = false) {
  // Skip email if in test mode
  if (skipEmail) {
    console.log(`[Tokens Sync ${syncId || ''}] 🧪 TEST MODE: Skipping email notification to ${userEmail}`);
    return;
  }

  const transactionalId = process.env.LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED;
  const loopsApiKey = process.env.LOOPS_API_KEY;

  if (!transactionalId) {
    console.error(`[Tokens Sync ${syncId || ''}] LOOPS_TRANSACTIONAL_ID_SYNC_COMPLETED is not set. Cannot send email.`);
    return;
  }
  if (!loopsApiKey) {
    console.warn(`[Tokens Sync ${syncId || ''}] LOOPS_API_KEY is not set. Email might not send if API key is required.`);
  }
  if (!userEmail) {
    console.error(`[Tokens Sync ${syncId || ''}] User email is not available. Cannot send completion email.`);
    return;
  }

  try {
    const response = await fetch('https://app.loops.so/api/v1/transactional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loopsApiKey}`,
      },
      body: JSON.stringify({
        transactionalId: transactionalId,
        email: userEmail,
      }),
    });

    if (response.ok) {
      const responseData = await response.json();
      console.log(`[Tokens Sync ${syncId || ''}] Sync completed email sent successfully to ${userEmail}:`, responseData);
    } else {
      const errorData = await response.text();
      console.error(`[Tokens Sync ${syncId || ''}] Failed to send sync completed email to ${userEmail}. Status: ${response.status}, Response: ${errorData}`);
    }
  } catch (error) {
    console.error(`[Tokens Sync ${syncId || ''}] Error sending sync completed email to ${userEmail}:`, error);
  }
}

export const maxDuration = 3600; // Set max duration to 1 hour for Railway (supports long-running processes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  // Declare requestData here to make sync_id available in catch
  let requestData; 
  try {
    requestData = await request.json();
    const { organization_id, sync_id, access_token, refresh_token, users } = requestData;
    
    // Check if we should skip emails (test mode)
    const skipEmail = request.headers.get('X-Skip-Email') === 'true';
    const isTestMode = request.headers.get('X-Test-Mode') === 'true';
    
    if (isTestMode) {
      console.log(`[Tokens API ${sync_id}] 🧪 Running in TEST MODE - emails will be skipped`);
    }
    
    console.log(`[Tokens API ${sync_id}] Starting token fetch processing with resource monitoring`);
    
    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      console.error(`[Tokens API ${sync_id}] Missing required fields`);
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Await the processTokens function
    await processTokens(organization_id, sync_id, access_token, refresh_token, users, request, skipEmail);
    
    console.log(`[Tokens API ${sync_id}] Token fetch completed successfully`);
    return NextResponse.json({ 
      message: 'Token fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id,
      testMode: isTestMode
    });

  } catch (error: any) {
    const sync_id_for_error = requestData?.sync_id; // Use optional chaining
    console.error(`[Tokens API ${sync_id_for_error || 'unknown'}] Error:`, error);
    // processTokens is responsible for updating sync_status to FAILED.
    // This handler just ensures a 500 response is sent.
    return NextResponse.json(
      { error: 'Failed to process tokens', details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to force garbage collection and memory cleanup
const forceMemoryCleanup = () => {
  if (global.gc) {
    global.gc();
  }
  // Clear any lingering references
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 1024 * 1024 * 1024) { // If using > 1GB heap
      console.log(`Memory usage high: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, forcing cleanup`);
      if (global.gc) global.gc();
    }
  }
};

async function processTokens(
  organization_id: string, 
  sync_id: string, 
  access_token: string,
  refresh_token: string,
  users: Array<{googleId: string, userId: string}> | undefined,
  request: Request,
  skipEmail: boolean
) {
  const monitor = ResourceMonitor.getInstance();
  
  try {
    console.log(`[Tokens ${sync_id}] Starting token fetch for organization: ${organization_id}`);
    
    // Log initial resource usage
    monitor.logResourceUsage(`Tokens ${sync_id} START`);
    
    // Define the required scopes for background Google sync
    const GOOGLE_SYNC_SCOPES = [
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/admin.directory.token.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ].join(' ');

    // Initialize Google Workspace service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({ 
      access_token,
      refresh_token,
      scope: GOOGLE_SYNC_SCOPES // Explicitly set scopes
    });
    
    // Create a user map if one was not provided
    let userMap = new Map<string, string>();
    if (!users || users.length === 0) {
      console.log(`[Tokens ${sync_id}] No user mapping provided, waiting for users in database`);
      
      try {
        const dbUsers = await waitForUsers(organization_id, sync_id);
        
        // Map users by Google ID and email
        dbUsers.forEach(user => {
          if (user.google_user_id) {
            userMap.set(user.google_user_id, user.id);
          }
          if (user.email) {
            userMap.set(user.email.toLowerCase(), user.id);
          }
        });
        
        console.log(`[Tokens ${sync_id}] Successfully mapped ${userMap.size} users`);
      } catch (error) {
        console.error(`[Tokens ${sync_id}] Error waiting for users:`, error);
        await updateSyncStatus(sync_id, 0, `Failed to get users: ${(error as Error).message}`, 'FAILED');
        throw error;
      }
    } else {
      console.log(`[Tokens ${sync_id}] Using provided user mapping with ${users.length} entries`);
      users.forEach(user => {
        userMap.set(user.googleId, user.userId);
      });
    }
    
    console.log(`[Tokens ${sync_id}] User map has ${userMap.size} entries`);
    
    // Fetch OAuth tokens
    let applicationTokens = [];
    try {
      await updateSyncStatus(sync_id, 40, 'Fetching application tokens from Google Workspace');
      applicationTokens = await googleService.getOAuthTokens();
      console.log(`[Tokens ${sync_id}] Fetched ${applicationTokens.length} application tokens`);
      
      // **NEW: Emergency check for huge organizations**
      if (applicationTokens.length > EMERGENCY_LIMITS.MAX_TOKENS_IN_MEMORY) {
        console.warn(`[Tokens ${sync_id}] 🚨 HUGE ORG DETECTED: ${applicationTokens.length} tokens exceeds limit of ${EMERGENCY_LIMITS.MAX_TOKENS_IN_MEMORY}`);
        throw new Error(`Organization too large for current memory configuration. Please contact support for enterprise processing of ${applicationTokens.length} tokens.`);
      }
      
      // Log resource usage after token fetch
      monitor.logResourceUsage(`Tokens ${sync_id} FETCH COMPLETE`);
    } catch (tokenError) {
      console.error(`[Tokens ${sync_id}] Error fetching OAuth tokens:`, tokenError);
      await updateSyncStatus(sync_id, 0, 'Failed to fetch application tokens from Google Workspace', 'FAILED');
      throw tokenError;
    }
    
    await updateSyncStatus(sync_id, 50, `Processing ${applicationTokens.length} application tokens with resource-aware batching`);
    
    // **NEW: Process tokens with resource-aware grouping**
    console.log(`[Tokens ${sync_id}] Processing tokens with resource-aware batching`);
    
    // Group applications by display name (process in resource-aware batches)
    const appNameMap = new Map<string, any[]>();
    
    // Determine optimal batch size based on current resources
    const usage = monitor.getCurrentUsage();
    const memoryRatio = Math.max(usage.heapUsed / 1600, usage.rss / 1600);
    const dynamicBatchSize = memoryRatio > 0.7 ? 25 : memoryRatio > 0.5 ? 50 : 75;
    
    console.log(`[Tokens ${sync_id}] Using dynamic batch size: ${dynamicBatchSize} (memory ratio: ${(memoryRatio * 100).toFixed(1)}%)`);
    
    // Process tokens in resource-aware batches
    await processInBatchesWithResourceControl(
      applicationTokens,
      async (tokenBatch) => {
        for (const token of tokenBatch) {
          const appName = token.displayText || 'Unknown App';
          
          if (!appName) {
            console.warn('Skipping token with missing app name');
            continue;
          }
          
          if (!appNameMap.has(appName)) {
            appNameMap.set(appName, []);
          }
          
          // Add token with user info
          appNameMap.get(appName)!.push(token);
        }
      },
      `Tokens ${sync_id} GROUPING`,
      dynamicBatchSize,
      50 // Base delay
    );
    
    console.log(`[Tokens ${sync_id}] Grouped tokens into ${appNameMap.size} applications`);
    
    // Prepare bulk upsert operations
    const applicationsToUpsert: any[] = [];
    const userAppRelationsToProcess: { appName: string, userId: string, userEmail: string, token: any }[] = [];
    
    // **NEW: Process applications with concurrent resource-aware processing**
    let appCount = 0;
    const totalApps = appNameMap.size;
    const appEntries = Array.from(appNameMap.entries());
    
    console.log(`[Tokens ${sync_id}] Processing ${totalApps} applications with resource-aware concurrency`);
    
    // **NEW: Emergency check for huge app count**
    if (totalApps > EMERGENCY_LIMITS.MAX_APPS_IN_MEMORY) {
      console.warn(`[Tokens ${sync_id}] 🚨 HUGE ORG DETECTED: ${totalApps} apps exceeds limit of ${EMERGENCY_LIMITS.MAX_APPS_IN_MEMORY}`);
      throw new Error(`Organization has too many applications (${totalApps}) for current memory configuration. Please contact support for enterprise processing.`);
    }
    
    // Process applications in concurrent batches with resource monitoring
    await processConcurrentlyWithResourceControl(
      appEntries,
      async ([appName, tokens]: [string, any[]]) => {
        appCount++;
        const progressPercent = 50 + Math.floor((appCount / totalApps) * 25);
        
        // **NEW: Force memory cleanup every 100 apps or when memory is high**
        if (appCount % 100 === 0) {
          const usage = monitor.getCurrentUsage();
          if (usage.heapUsed > EMERGENCY_LIMITS.FORCE_CLEANUP_THRESHOLD) {
            console.log(`[Tokens ${sync_id}] 🧹 Force cleanup at app ${appCount}/${totalApps} - Memory: ${usage.heapUsed}MB`);
            monitor.forceCleanup();
            await new Promise(resolve => setTimeout(resolve, 500)); // Allow GC to run
          }
        }
        
        if (appCount % 10 === 0 || appCount === totalApps) {
          await updateSyncStatus(
            sync_id, 
            progressPercent, 
            `Processing application ${appCount}/${totalApps} with resource monitoring`
          );
        }
        
        // Determine highest risk level based on ALL scopes combined
        const allScopesForRiskEvaluation = new Set<string>();
        tokens.forEach((token: any) => {
          if (token.scopes && Array.isArray(token.scopes)) {
            token.scopes.forEach((scope: string) => allScopesForRiskEvaluation.add(scope));
          }
        });

        // Now evaluate risk based on the combined set of scopes
        const highestRiskLevel = determineRiskLevel(Array.from(allScopesForRiskEvaluation));
        
        // Check if app already exists
        const { data: existingApp } = await supabaseAdmin
          .from('applications')
          .select('id, management_status')
          .eq('name', appName)
          .eq('organization_id', organization_id)
          .maybeSingle();
        
        // Add to batch of applications to upsert
        const appRecord: any = {
          google_app_id: tokens.map(t => t.clientId).join(','),
          name: appName,
          category: 'Unknown',
          risk_level: highestRiskLevel,
          management_status: existingApp?.management_status || 'Not specified',
          total_permissions: allScopesForRiskEvaluation.size,
          all_scopes: Array.from(allScopesForRiskEvaluation),
          organization_id: organization_id,
          updated_at: new Date().toISOString()
        };
        
        if (existingApp) {
          // Update existing app with its ID
          appRecord.id = existingApp.id;
        } else {
          // Generate a new UUID for new applications
          appRecord.id = crypto.randomUUID();
        }
        
        applicationsToUpsert.push(appRecord);
        
        // Process each token to create user-application relationships
        for (const token of tokens) {
          const userKey = token.userKey;
          const userEmail = token.userEmail;
          
          // Try to get user ID from map using different keys
          let userId = null;
          
          // Try by Google user ID first
          if (userKey && userMap.has(userKey)) {
            userId = userMap.get(userKey);
          }
          
          // Fall back to email if available
          if (!userId && userEmail) {
            // Try normalized email
            const normalizedEmail = userEmail.toLowerCase();
            if (userMap.has(normalizedEmail)) {
              userId = userMap.get(normalizedEmail);
            }
          }
          
          if (!userId) {
            // Log the missing user details for debugging
            console.warn('No matching user found for token:', {
              userKey: userKey || 'missing',
              userEmail: userEmail || 'missing',
              appName: appName
            });
            continue;
          }
          
          // Extract only the necessary parts of the token to avoid serialization issues
          const simplifiedToken = {
            scopes: token.scopes || [],
            scopeData: token.scopeData || [],
            scope: token.scope || '',
            permissions: token.permissions || [],
            displayText: token.displayText || ''
          };
          
          // Check if this user-app relationship already exists in our processing list
          const existingRelationIndex = userAppRelationsToProcess.findIndex(rel => 
            rel.appName === appName && rel.userId === userId
          );
          
          if (existingRelationIndex !== -1) {
            // Merge token scopes with existing record instead of duplicating
            const existingToken = userAppRelationsToProcess[existingRelationIndex].token;
            existingToken.scopes = [...new Set([...(existingToken.scopes || []), ...(simplifiedToken.scopes || [])])];
            
            // Merge other scope data if needed
            if (simplifiedToken.scopeData && simplifiedToken.scopeData.length > 0) {
              existingToken.scopeData = [...(existingToken.scopeData || []), ...simplifiedToken.scopeData];
            }
            
            // Update the scope string if needed
            if (simplifiedToken.scope) {
              existingToken.scope = existingToken.scope 
                ? `${existingToken.scope} ${simplifiedToken.scope}`
                : simplifiedToken.scope;
            }
            
            // Update permissions if needed
            if (simplifiedToken.permissions && simplifiedToken.permissions.length > 0) {
              existingToken.permissions = [...(existingToken.permissions || []), ...simplifiedToken.permissions];
            }
          } else {
            // Add a new relationship if none exists
            userAppRelationsToProcess.push({
              appName,
              userId,
              userEmail: userEmail || '',
              token: simplifiedToken
            });
            
            // **NEW: Emergency check for relations array size**
            if (userAppRelationsToProcess.length > EMERGENCY_LIMITS.MAX_RELATIONS_IN_MEMORY) {
              console.warn(`[Tokens ${sync_id}] 🚨 HUGE ORG DETECTED: ${userAppRelationsToProcess.length} relations exceeds limit`);
              throw new Error(`Organization has too many user-app relationships (${userAppRelationsToProcess.length}) for current memory configuration. Please contact support for enterprise processing.`);
            }
          }
        }
        
        // Clear processed tokens from memory to prevent buildup
        tokens.length = 0;
      },
      `Tokens ${sync_id} APPS`,
      undefined // Let the resource monitor determine optimal concurrency
    );
    
    // Log resource usage after app processing
    monitor.logResourceUsage(`Tokens ${sync_id} APPS COMPLETE`);
    
    // Save applications in resource-aware batches
    await updateSyncStatus(sync_id, 75, `Saving ${applicationsToUpsert.length} applications with resource monitoring`);
    
    await processInBatchesWithResourceControl(
      applicationsToUpsert,
      async (appBatch) => {
        try {
          const { error } = await supabaseAdmin
            .from('applications')
            .upsert(appBatch);
          
          if (error) {
            console.error(`[Tokens ${sync_id}] Error upserting application batch:`, error);
          }
        } catch (err) {
          console.error('Error during application batch upsert:', err);
        }
      },
      `Tokens ${sync_id} APPS SAVE`,
      25, // Conservative batch size for database operations
      100 // Base delay
    );
    
    // Get the latest application IDs for the relationship mapping
    const { data: dbApps } = await supabaseAdmin
      .from('applications')
      .select('id, name')
      .eq('organization_id', organization_id);
    
    // Create a mapping for quick lookup (app name -> app ID)
    const appNameToIdMap = new Map<string, string>();
    if (dbApps) {
      dbApps.forEach(app => {
        appNameToIdMap.set(app.name, app.id);
      });
    }
    
    // Get URL info for API calls
    const selfUrl = request.headers.get('host') || process.env.VERCEL_URL || 'localhost:3000';
    const protocol = selfUrl.includes('localhost') ? 'http://' : 'https://';
    
    // Trigger app categorization process in parallel
    const categorizeUrl = `${protocol}${selfUrl}/api/background/sync/categorize`;
    
    console.log(`[Tokens ${sync_id}] Triggering app categorization at: ${categorizeUrl}`);
    
    // Prepare user app relationships for the next phase
    await updateSyncStatus(sync_id, 80, `Preparing user-application relationships with resource monitoring`);
    // Construct a data structure for relations processing
    const appMap = Array.from(appNameToIdMap.entries()).map(([appName, appId]) => ({ appName, appId }));
    // Trigger the final phase - the relationships processing
    await updateSyncStatus(sync_id, 80, 'Saving application token relationships');
    
    const nextUrl = `${protocol}${selfUrl}/api/background/sync/relations`;
    console.log(`Triggering relations processing at: ${nextUrl}`);
    console.log(`Prepared ${userAppRelationsToProcess.length} user-app relations and ${appMap.length} app mappings`);
    
    if (userAppRelationsToProcess.length === 0) {
      console.warn(`[Tokens ${sync_id}] No user-application relations to process - check user mapping and token data`);
      await updateSyncStatus(
        sync_id, 
        100, 
        `Processing complete. No user-application relations could be created.`,
        'COMPLETED'
      );
      // Fire-and-forget categorization
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });
      return;
    }

    try {
      const nextResponse = await fetch(nextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id,
          sync_id,
          userAppRelations: userAppRelationsToProcess,
          appMap: appMap
        }),
      });

      if (!nextResponse.ok) {
        const errorText = await nextResponse.text();
        console.error(`Failed to trigger relations processing: ${nextResponse.status} ${nextResponse.statusText}`);
        console.error(`Response details: ${errorText}`);
        await updateSyncStatus(
          sync_id, 
          100, 
          `Completed with issues. Some relationships could not be processed.`,
          'COMPLETED'
        );
      } else {
        await updateSyncStatus(
          sync_id, 
          100, 
          `Token processing complete, finalizing data...`,
          'COMPLETED'
        );
      }

      // Fetch user_email and send email (or skip)
      const { data: syncInfo, error: syncInfoError } = await supabaseAdmin
        .from('sync_status')
        .select('user_email')
        .eq('id', sync_id)
        .single();

      if (syncInfoError) {
        console.error(`[Tokens ${sync_id}] Error fetching sync info for email:`, syncInfoError.message);
      } else if (syncInfo && syncInfo.user_email) {
        if (skipEmail) {
          console.log(`[Tokens ${sync_id}] 🧪 TEST MODE: Skipping email notification to ${syncInfo.user_email}`);
        } else {
          await sendSyncCompletedEmail(syncInfo.user_email, sync_id);
        }
      }

      // Fire-and-forget categorization (do not await)
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });

      // Log final resource usage
      monitor.logResourceUsage(`Tokens ${sync_id} COMPLETE`);

      console.log(`[Tokens ${sync_id}] Token processing completed successfully`);
    } catch (relationError) {
      console.error(`[Tokens ${sync_id}] Error triggering relations processing:`, relationError);
      await updateSyncStatus(
        sync_id, 
        100, 
        `Completed with issues. Some relationships could not be processed.`,
        'COMPLETED'
      );
      // Still attempt categorization
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id, sync_id }),
      }).catch(error => {
        console.warn(`[Tokens ${sync_id}] Error triggering categorization:`, error);
      });
    }
  } catch (error: any) {
    console.error(`[Tokens ${sync_id}] Error in token processing:`, error);
    
    // Log resource usage on error
    monitor.logResourceUsage(`Tokens ${sync_id} ERROR`);
    
    await updateSyncStatus(
      sync_id,
      0,
      `Token processing failed: ${error.message}`,
      'FAILED'
    );
    throw error;
  }
}