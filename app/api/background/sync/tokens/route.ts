import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel } from '@/lib/risk-assessment';
import { ResourceMonitor, resourceAwareSleep, calculateOptimalBatchSize } from '@/lib/resource-monitor';
import crypto from 'crypto';

// Resource-aware configuration - Balanced settings for single CPU with controlled parallelism
const PROCESSING_CONFIG = {
  BASE_BATCH_SIZE: 15, // Base batch size for token processing
  MIN_BATCH_SIZE: 5,   // Minimum batch size when resources are high
  MAX_BATCH_SIZE: 30,  // Maximum batch size when resources are low
  BASE_DELAY_BETWEEN_BATCHES: 150, // Base delay for controlled processing
  MIN_DELAY_BETWEEN_BATCHES: 75,
  MAX_DELAY_BETWEEN_BATCHES: 2000, // Maximum delay when throttling
  MAX_TOKENS_PER_BATCH: 50, // Maximum tokens per batch
  DB_OPERATION_DELAY: 100, // Delay for DB operations
  MEMORY_CLEANUP_INTERVAL: 75, // More frequent cleanup
  RESOURCE_CHECK_INTERVAL: 5, // Check resources every 5 batches
  EMERGENCY_BRAKE_THRESHOLD: 3, // Trigger emergency brake after 3 consecutive throttles
  // NEW: Concurrency settings for single CPU
  MAX_CONCURRENT_OPERATIONS: 2, // Conservative for token processing on single CPU
  MIN_CONCURRENT_OPERATIONS: 1, // Minimum when resources are high
  ADAPTIVE_CONCURRENCY: true,   // Enable dynamic concurrency adjustment
  CONCURRENCY_REDUCTION_THRESHOLD: 70, // Lower threshold for token processing
  CONCURRENCY_INCREASE_THRESHOLD: 45,  // CPU/Memory % to allow more concurrency
};

// Resource limits - Conservative for single CPU
const RESOURCE_LIMITS = {
  maxCpuPercent: 80,
  maxMemoryPercent: 80,
  warningCpuPercent: 70,
  warningMemoryPercent: 70,
};

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  
  console.log(`🔄 [Tokens ${syncId}] Processing ${chunks.length} chunks of ${batchType} with adaptive parallelism`);
  
  // Process chunks with controlled parallelism
  for (let i = 0; i < chunks.length; i += PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS) {
    // Check if system is overloaded
    if (resourceMonitor.isOverloaded()) {
      console.warn(`🚨 [Tokens ${syncId}] System overloaded while processing ${batchType}, waiting for recovery...`);
      
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
      console.log(`🔍 [Tokens ${syncId}] Resource usage: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%, Concurrency: ${parallelBatch.length} (${batchType})`);
    }
    
    // Process batches in parallel with resource monitoring
    try {
      await Promise.all(parallelBatch.map(async (chunk) => {
        try {
          await processor(chunk);
          processedCount += chunk.length;
        } catch (chunkError) {
          console.error(`[Tokens ${syncId}] Error processing ${batchType} chunk:`, chunkError);
          // Continue with other chunks
        }
      }));
    } catch (parallelError) {
      console.error(`[Tokens ${syncId}] Error in parallel ${batchType} processing:`, parallelError);
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
      
      console.log(`⚠️  [Tokens ${syncId}] Throttling ${batchType}: ${throttleDelay}ms additional delay (consecutive: ${consecutiveThrottles})`);
    } else {
      consecutiveThrottles = 0;
      delay = Math.max(PROCESSING_CONFIG.MIN_DELAY_BETWEEN_BATCHES, delay);
    }
    
    // Emergency brake if too many consecutive throttles
    if (consecutiveThrottles > PROCESSING_CONFIG.EMERGENCY_BRAKE_THRESHOLD) {
      emergencyBrakeCount++;
      console.warn(`🚨 [Tokens ${syncId}] Emergency brake #${emergencyBrakeCount}: Too many consecutive throttles for ${batchType}, forcing extended pause`);
      await resourceAwareSleep(8000, resourceMonitor); // 8 second pause
      consecutiveThrottles = 0;
      
      // If we hit emergency brake too many times, something is wrong
      if (emergencyBrakeCount > 3) {
        throw new Error(`Emergency brake triggered ${emergencyBrakeCount} times for ${batchType} - system may be overloaded`);
      }
    }
    
    // Apply delay if not the last parallel batch
    if (i + optimalConcurrency < chunks.length) {
      await resourceAwareSleep(delay, resourceMonitor);
    }
  }
  
  console.log(`✅ [Tokens ${syncId}] Completed parallel processing of ${processedCount} ${batchType} (Emergency brakes: ${emergencyBrakeCount})`);
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
  let resourceMonitor: ResourceMonitor | undefined;
  
  try {
    requestData = await request.json();
    const { organization_id, sync_id, access_token, refresh_token, users } = requestData;
    
    // Check if we should skip emails (test mode)
    const skipEmail = request.headers.get('X-Skip-Email') === 'true';
    const isTestMode = request.headers.get('X-Test-Mode') === 'true';
    
    if (isTestMode) {
      console.log(`[Tokens API ${sync_id}] 🧪 Running in TEST MODE - emails will be skipped`);
    }
    
    // Initialize resource monitoring
    resourceMonitor = ResourceMonitor.getInstance(RESOURCE_LIMITS);
    resourceMonitor.startMonitoring(1000); // Check every second
    
    // Set up resource monitoring event handlers
    resourceMonitor.on('overload', (usage) => {
      console.warn(`🚨 [Tokens ${sync_id}] RESOURCE OVERLOAD: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    resourceMonitor.on('warning', (usage) => {
      console.warn(`⚠️  [Tokens ${sync_id}] RESOURCE WARNING: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    // Log initial resource state
    const initialUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Tokens ${sync_id}] Initial resource usage: CPU: ${initialUsage.cpuPercent.toFixed(1)}%, Memory: ${initialUsage.memoryPercent.toFixed(1)}%`);
    
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
    await processTokens(organization_id, sync_id, access_token, refresh_token, users, request, skipEmail, resourceMonitor);
    
    // Log final resource state
    const finalUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Tokens ${sync_id}] Final resource usage: CPU: ${finalUsage.cpuPercent.toFixed(1)}%, Memory: ${finalUsage.memoryPercent.toFixed(1)}%`);
    
    console.log(`[Tokens API ${sync_id}] Token fetch completed successfully`);
    return NextResponse.json({ 
      message: 'Token fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id,
      testMode: isTestMode,
      resourceUsage: {
        initial: initialUsage,
        final: finalUsage
      }
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
  } finally {
    // Always stop monitoring when done
    if (resourceMonitor) {
      resourceMonitor.stopMonitoring();
    }
  }
}

async function processTokens(
  organization_id: string, 
  sync_id: string, 
  access_token: string,
  refresh_token: string,
  users: Array<{googleId: string, userId: string}> | undefined,
  request: Request,
  skipEmail: boolean,
  resourceMonitor: ResourceMonitor
) {
  try {
    console.log(`[Tokens ${sync_id}] Starting token fetch for organization: ${organization_id} with resource monitoring`);
    
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
    } catch (tokenError) {
      console.error(`[Tokens ${sync_id}] Error fetching OAuth tokens:`, tokenError);
      await updateSyncStatus(sync_id, 0, 'Failed to fetch application tokens from Google Workspace', 'FAILED');
      throw tokenError;
    }
    
    await updateSyncStatus(sync_id, 50, `Processing ${applicationTokens.length} application tokens with resource monitoring`);
    
    // Process tokens in resource-aware parallel batches
    console.log(`[Tokens ${sync_id}] Processing tokens with resource monitoring and adaptive parallelism`);
    
    // Group applications by display name with resource awareness
    const appNameMap = new Map<string, any[]>();
    
    // Process tokens in resource-aware parallel batches to avoid memory overload
    await processInResourceAwareParallelBatches(
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
      resourceMonitor,
      sync_id,
      'tokens'
    );
    
    console.log(`[Tokens ${sync_id}] Grouped tokens into ${appNameMap.size} applications`);
    
    // Prepare bulk upsert operations
    const applicationsToUpsert: any[] = [];
    const userAppRelationsToProcess: { appName: string, userId: string, userEmail: string, token: any }[] = [];
    
    // Process each application with resource awareness
    let appCount = 0;
    const totalApps = appNameMap.size;
    const appEntries = Array.from(appNameMap.entries());
    
    // Process applications in resource-aware parallel batches
    await processInResourceAwareParallelBatches(
      appEntries,
      async (appBatch) => {
        for (const [appName, tokens] of appBatch) {
          appCount++;
          const progressPercent = 50 + Math.floor((appCount / totalApps) * 25);
          
          if (appCount % 10 === 0 || appCount === totalApps) {
            await updateSyncStatus(
              sync_id, 
              progressPercent, 
              `Processing application ${appCount}/${totalApps} (Resource-Aware)`
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
            .select('id')
            .eq('name', appName)
            .eq('organization_id', organization_id)
            .maybeSingle();
          
          // Add to batch of applications to upsert
          const appRecord: any = {
            google_app_id: tokens.map(t => t.clientId).join(','),
            name: appName,
            category: 'Unknown',
            risk_level: highestRiskLevel,
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
            }
          }
          
          // Clear processed tokens from memory to prevent buildup
          tokens.length = 0;
        }
        
        // Clear the batch from memory
        appBatch.length = 0;
      },
      resourceMonitor,
      sync_id,
      'applications'
    );
    
    // Save applications in resource-aware parallel batches
    await updateSyncStatus(sync_id, 75, `Saving ${applicationsToUpsert.length} applications (Resource-Aware)`);
    
    await processInResourceAwareParallelBatches(
      applicationsToUpsert,
      async (appBatch) => {
        try {
          const { error } = await supabaseAdmin
            .from('applications')
            .upsert(appBatch);
          
          if (error) {
            console.error(`[Tokens ${sync_id}] Error upserting application batch:`, error);
            // Continue processing other batches instead of failing completely
          }
        } catch (err) {
          console.error('Error during application batch upsert:', err);
          // Continue processing other batches
        }
      },
      resourceMonitor,
      sync_id,
      'application records'
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
    await updateSyncStatus(sync_id, 80, `Preparing user-application relationships (Resource-Aware)`);
    // Construct a data structure for relations processing
    const appMap = Array.from(appNameToIdMap.entries()).map(([appName, appId]) => ({ appName, appId }));
    // Trigger the final phase - the relationships processing
    await updateSyncStatus(sync_id, 80, 'Saving application token relationships (Resource-Aware)');
    
    const nextUrl = `${protocol}${selfUrl}/api/background/sync/relations`;
    console.log(`[Tokens ${sync_id}] Triggering relations processing at: ${nextUrl}`);
    console.log(`[Tokens ${sync_id}] Prepared ${userAppRelationsToProcess.length} user-app relations and ${appMap.length} app mappings`);
    
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
        console.error(`[Tokens ${sync_id}] Failed to trigger relations processing: ${nextResponse.status} ${nextResponse.statusText}`);
        console.error(`[Tokens ${sync_id}] Response details: ${errorText}`);
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
          `Token processing complete, finalizing data... (Resource-Aware)`,
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

      console.log(`[Tokens ${sync_id}] Token processing completed successfully with resource monitoring`);
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
    await updateSyncStatus(
      sync_id,
      0,
      `Token processing failed: ${error.message}`,
      'FAILED'
    );
    throw error;
  }
}