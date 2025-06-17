import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor, resourceAwareSleep, calculateOptimalBatchSize } from '@/lib/resource-monitor';

// Resource-aware configuration - Balanced settings for single CPU with controlled parallelism
const PROCESSING_CONFIG = {
  BASE_BATCH_SIZE: 25, // Base batch size - will be adjusted dynamically
  MIN_BATCH_SIZE: 5,   // Minimum batch size when resources are high
  MAX_BATCH_SIZE: 50,  // Maximum batch size when resources are low
  BASE_DELAY_BETWEEN_BATCHES: 100, // Reduced from 150 for better throughput
  MIN_DELAY_BETWEEN_BATCHES: 50,   // Minimum delay
  MAX_DELAY_BETWEEN_BATCHES: 1000, // Maximum delay when throttling
  DB_OPERATION_DELAY: 75, // Base delay for DB operations
  MEMORY_CLEANUP_INTERVAL: 50, // Cleanup every N operations
  RESOURCE_CHECK_INTERVAL: 10, // Check resources every N batches
  // NEW: Concurrency settings for single CPU
  MAX_CONCURRENT_OPERATIONS: 3, // Maximum parallel operations for single CPU
  MIN_CONCURRENT_OPERATIONS: 1, // Minimum when resources are high
  ADAPTIVE_CONCURRENCY: true,   // Enable dynamic concurrency adjustment
  CONCURRENCY_REDUCTION_THRESHOLD: 75, // CPU/Memory % to reduce concurrency
  CONCURRENCY_INCREASE_THRESHOLD: 50,  // CPU/Memory % to allow more concurrency
};

// Resource limits
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
  syncId: string
): Promise<void> {
  let processedCount = 0;
  let consecutiveThrottles = 0;
  
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
  
  console.log(`🔄 [Users ${syncId}] Processing ${chunks.length} chunks with adaptive parallelism`);
  
  // Process chunks with controlled parallelism
  for (let i = 0; i < chunks.length; i += PROCESSING_CONFIG.MAX_CONCURRENT_OPERATIONS) {
    // Check if system is overloaded
    if (resourceMonitor.isOverloaded()) {
      console.warn(`🚨 [Users ${syncId}] System overloaded, waiting for recovery...`);
      
      let waitTime = 0;
      const maxWaitTime = 30000; // 30 seconds max wait
      
      while (resourceMonitor.isOverloaded() && waitTime < maxWaitTime) {
        await resourceAwareSleep(1000, resourceMonitor);
        waitTime += 1000;
      }
      
      if (resourceMonitor.isOverloaded()) {
        throw new Error('System resources remain critically high after 30 seconds');
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
      console.log(`🔍 [Users ${syncId}] Resource usage: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%, Concurrency: ${parallelBatch.length}`);
    }
    
    // Process batches in parallel with resource monitoring
    try {
      await Promise.all(parallelBatch.map(async (chunk) => {
        try {
          await processor(chunk);
          processedCount += chunk.length;
        } catch (chunkError) {
          console.error(`[Users ${syncId}] Error processing chunk:`, chunkError);
          // Continue with other chunks
        }
      }));
    } catch (parallelError) {
      console.error(`[Users ${syncId}] Error in parallel processing:`, parallelError);
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
      
      console.log(`⚠️  [Users ${syncId}] Throttling: ${throttleDelay}ms additional delay (consecutive: ${consecutiveThrottles})`);
    } else {
      consecutiveThrottles = 0;
      delay = Math.max(PROCESSING_CONFIG.MIN_DELAY_BETWEEN_BATCHES, delay);
    }
    
    // Emergency brake if too many consecutive throttles
    if (consecutiveThrottles > 5) {
      console.warn(`🚨 [Users ${syncId}] Emergency brake: Too many consecutive throttles, forcing extended pause`);
      await resourceAwareSleep(5000, resourceMonitor);
      consecutiveThrottles = 0;
    }
    
    // Apply delay if not the last parallel batch
    if (i + optimalConcurrency < chunks.length) {
      await resourceAwareSleep(delay, resourceMonitor);
    }
  }
  
  console.log(`✅ [Users ${syncId}] Completed parallel processing of ${processedCount} items`);
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

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  const requestData = await request.json(); // Moved up for error handling access
  const { organization_id, sync_id, access_token, refresh_token } = requestData;
  
  let resourceMonitor: ResourceMonitor | undefined;

  try {
    console.log('[Users API] Starting user fetch processing with resource monitoring');
    
    // Initialize resource monitoring
    resourceMonitor = ResourceMonitor.getInstance(RESOURCE_LIMITS);
    resourceMonitor.startMonitoring(1000); // Check every second
    
    // Set up resource monitoring event handlers
    resourceMonitor.on('overload', (usage) => {
      console.warn(`🚨 [Users ${sync_id}] RESOURCE OVERLOAD: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    resourceMonitor.on('warning', (usage) => {
      console.warn(`⚠️  [Users ${sync_id}] RESOURCE WARNING: CPU: ${usage.cpuPercent.toFixed(1)}%, Memory: ${usage.memoryPercent.toFixed(1)}%`);
    });
    
    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Log initial resource state
    const initialUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Users ${sync_id}] Initial resource usage: CPU: ${initialUsage.cpuPercent.toFixed(1)}%, Memory: ${initialUsage.memoryPercent.toFixed(1)}%`);
    
    // Await the processing
    await processUsers(organization_id, sync_id, access_token, refresh_token, request, resourceMonitor);
    
    // Log final resource state
    const finalUsage = resourceMonitor.getCurrentUsage();
    console.log(`🔍 [Users ${sync_id}] Final resource usage: CPU: ${finalUsage.cpuPercent.toFixed(1)}%, Memory: ${finalUsage.memoryPercent.toFixed(1)}%`);
    
    // Return success response after processing is done
    return NextResponse.json({ 
      message: 'User fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id,
      resourceUsage: {
        initial: initialUsage,
        final: finalUsage
      }
    });

  } catch (error: any) {
    console.error('[Users API] Error in user fetch API:', error);
    // Ensure sync status is updated on failure if processUsers throws
    if (sync_id) { // Check if sync_id is available
        await updateSyncStatus(
          sync_id,
          0, // Use 0 instead of -1 to avoid constraint violation
          `User fetch failed: ${error.message}`,
          'FAILED'
        );
    }
    return NextResponse.json(
      { error: 'Failed to process users', details: error.message },
      { status: 500 }
    );
  } finally {
    // Always stop monitoring when done
    if (resourceMonitor) {
      resourceMonitor.stopMonitoring();
    }
  }
}

async function processUsers(
  organization_id: string, 
  sync_id: string, 
  access_token: string, 
  refresh_token: string,
  originalRequest: Request,
  resourceMonitor: ResourceMonitor
) {
  try {
    console.log(`[Users ${sync_id}] Starting user fetch for organization: ${organization_id}`);
    
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
      scope: GOOGLE_SYNC_SCOPES, // Explicitly set scopes
      expiry_date: Date.now() + 3600 * 1000
    });
    
    // Attempt to refresh tokens before making API calls
    console.log(`🔄 [Users ${sync_id}] Refreshing tokens before API calls...`);
    try {
      const refreshedTokens = await googleService.refreshAccessToken(true); // Force refresh
      if (refreshedTokens) {
        console.log(`✅ [Users ${sync_id}] Successfully refreshed tokens`);
        
        // Reinitialize the service with the refreshed tokens to ensure they're used
        await googleService.setCredentials({
          access_token: refreshedTokens.access_token,
          refresh_token: refreshedTokens.refresh_token,
          expiry_date: refreshedTokens.expiry_date || Date.now() + 3600 * 1000,
          scope: GOOGLE_SYNC_SCOPES, // Pass scopes back in
        });
        
        // Update the sync_status record with new tokens for future use
        await supabaseAdmin
          .from('sync_status')
          .update({
            access_token: refreshedTokens.access_token,
            refresh_token: refreshedTokens.refresh_token,
            updated_at: new Date().toISOString()
          })
          .eq('id', sync_id);
      }
    } catch (refreshError) {
      console.error(`❌ [Users ${sync_id}] Token refresh failed:`, refreshError);
      await updateSyncStatus(
        sync_id, 
        0, // Use 0 instead of -1 to avoid constraint violation
        `Token refresh failed: ${(refreshError as Error).message}`,
        'FAILED'
      );
      throw refreshError;
    }
    
    await updateSyncStatus(sync_id, 15, 'Fetching users from Google Workspace');
    
    // Fetch users
    let users = [];
    try {
      users = await googleService.getUsersListPaginated();
      console.log(`[Users ${sync_id}] Successfully fetched ${users.length} users`);
    } catch (error: any) {
      console.error(`[Users ${sync_id}] Error fetching users:`, error);
      
      // If user fetch fails, it's likely a token or permission issue
      const errorMessage = error.message.includes('Invalid Credentials') 
        ? 'Google authentication credentials are invalid. Please re-authenticate your Google Workspace account.'
        : `User fetch failed: ${error.message}`;
        
      await updateSyncStatus(sync_id, 0, errorMessage, 'FAILED'); // Use 0 instead of -1
      throw new Error(errorMessage);
    }
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users with resource monitoring`);
    
    // Process users with resource awareness
    console.log(`[Users ${sync_id}] Processing ${users.length} users with dynamic batching and resource monitoring`);
    
    let processedCount = 0;
    
    await processInResourceAwareParallelBatches(
      users,
      async (userBatch) => {
        // Create a batch of users to upsert
        const usersToUpsert = userBatch.map((user: any, index: number) => {
          try {
            // Determine department from orgUnitPath if available
            const department = user.orgUnitPath ? 
              user.orgUnitPath.split('/').filter(Boolean).pop() || null : 
              null;
              
            // Determine role based on isAdmin flag
            const role = user.isAdmin ? 'Admin' : 'User';
            
            // Safely access user name or use email as fallback
            const fullName = user.name && typeof user.name === 'object' ? 
              (user.name.fullName || `${user.name.givenName || ''} ${user.name.familyName || ''}`.trim() || user.primaryEmail) : 
              user.primaryEmail;
            
            // Make sure we have a valid Google user ID
            if (!user.id) {
              console.warn(`Missing Google ID for user ${user.primaryEmail} - using email as key`);
            }
            
            return {
              google_user_id: user.id || user.primaryEmail,
              email: user.primaryEmail,
              name: fullName,
              role: role,
              department: department,
              organization_id: organization_id,
              // Additional identifier fields to help with matching
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
          } catch (userError) {
            console.error(`Error processing user ${user.primaryEmail || 'unknown'}:`, userError);
            // Return a minimal valid record
            return {
              google_user_id: user.id || user.primaryEmail || `unknown-${Date.now()}-${Math.random()}`,
              email: user.primaryEmail || `unknown-${processedCount + index}@example.com`,
              name: 'Unknown User',
              role: 'User',
              department: null,
              organization_id: organization_id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
          }
        });
        
        // Log progress for large batches
        processedCount += userBatch.length;
        if (processedCount % 100 === 0 || processedCount === users.length) {
          const progress = 20 + Math.floor((processedCount / users.length) * 10);
          await updateSyncStatus(sync_id, progress, `Processed ${processedCount}/${users.length} users (Resource-Aware)`);
        }

        // Process this batch with optimized upsert strategy
        try {
          // Check for existing users by email for this batch
          const batchEmails = usersToUpsert.map(u => u.email);
          const { data: existingUsersData, error: fetchExistingError } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('organization_id', organization_id)
            .in('email', batchEmails);
            
          if (fetchExistingError) throw fetchExistingError;
          
          const existingEmails = new Set(existingUsersData?.map(u => u.email) || []);
          
          const usersToInsert = usersToUpsert.filter(u => !existingEmails.has(u.email));
          const usersToUpdate = usersToUpsert.filter(u => existingEmails.has(u.email));

          // Insert new users in bulk
          if (usersToInsert.length > 0) {
            const { error: insertError } = await supabaseAdmin
              .from('users')
              .insert(usersToInsert);
            if (insertError) {
              console.error(`Error inserting users batch:`, insertError);
              // Continue processing other batches instead of failing completely
            }
          }

          // Update existing users in smaller sub-batches to avoid database timeouts
          if (usersToUpdate.length > 0) {
            const updateBatchSize = 5; // Even smaller batch size for updates on limited resources
            for (let i = 0; i < usersToUpdate.length; i += updateBatchSize) {
              const updateBatch = usersToUpdate.slice(i, i + updateBatchSize);
              
              // Process updates individually to avoid conflicts
              for (const user of updateBatch) {
                try {
                  const { error: updateError } = await supabaseAdmin
                    .from('users')
                    .update({
                      name: user.name,
                      role: user.role,
                      department: user.department,
                      google_user_id: user.google_user_id,
                      updated_at: user.updated_at
                    })
                    .eq('email', user.email)
                    .eq('organization_id', organization_id);
                    
                  if (updateError) {
                    console.error(`Error updating user ${user.email}:`, updateError);
                    // Continue with next user instead of failing
                  }
                } catch (userUpdateError) {
                  console.error(`Error updating individual user ${user.email}:`, userUpdateError);
                  // Continue with next user
                }
              }
              
              // Small delay between update sub-batches with resource awareness
              if (i + updateBatchSize < usersToUpdate.length) {
                await resourceAwareSleep(PROCESSING_CONFIG.DB_OPERATION_DELAY, resourceMonitor);
              }
            }
          }
          
        } catch (batchError) {
          console.error(`Error processing user batch:`, batchError);
          // Continue with next batch instead of failing completely
        }
        
        // Clear processed data from memory
        usersToUpsert.length = 0;
        userBatch.length = 0;
      },
      resourceMonitor,
      sync_id
    );
    
    await updateSyncStatus(sync_id, 30, `User sync completed - processed ${users.length} users (Resource-Optimized)`);
    
    console.log(`[Users ${sync_id}] User processing completed successfully with resource monitoring`);
    
  } catch (error: any) {
    console.error(`[Users ${sync_id}] Error in user processing:`, error);
    throw error;
  }
} 