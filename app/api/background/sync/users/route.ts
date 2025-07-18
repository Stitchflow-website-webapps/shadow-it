import { NextResponse } from 'next/server';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { supabaseAdmin } from '@/lib/supabase';
import { ResourceMonitor, processInBatchesWithResourceControl } from '@/lib/resource-monitor';

// Configuration optimized for high-performance processing
const PROCESSING_CONFIG = {
  BATCH_SIZE: 150, // Large batches for speed
  DELAY_BETWEEN_BATCHES: 25, // Minimal delays for speed
  DB_OPERATION_DELAY: 25, // Fast DB operations
  MEMORY_CLEANUP_INTERVAL: 200, // Less frequent cleanup for speed
};

// **NEW: Emergency limits for huge organizations**
const EMERGENCY_LIMITS = {
  MAX_USERS_IN_MEMORY: 20000, // Hard limit on users processed at once (reduced for stability)
  FORCE_CLEANUP_THRESHOLD: 1000, // Force cleanup at 1.0GB (81% of 1.6GB limit)
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
  const requestData = await request.json(); // Moved up for error handling access
  const { organization_id, sync_id, access_token, refresh_token } = requestData;

  try {
    console.log('Starting user fetch processing with resource monitoring');
    
    // Validate required fields
    if (!organization_id || !sync_id || !access_token || !refresh_token) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Await the processing
    await processUsers(organization_id, sync_id, access_token, refresh_token, request);
    
    // Return success response after processing is done
    return NextResponse.json({ 
      message: 'User fetch completed successfully',
      syncId: sync_id,
      organizationId: organization_id
    });

  } catch (error: any) {
    console.error('Error in user fetch API:', error);
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
  }
}

async function processUsers(
  organization_id: string, 
  sync_id: string, 
  access_token: string, 
  refresh_token: string,
  originalRequest: Request
) {
  const monitor = ResourceMonitor.getInstance();
  
  try {
    console.log(`[Users ${sync_id}] Starting user fetch for organization: ${organization_id}`);
    
    // Log initial resource usage
    monitor.logResourceUsage(`Users ${sync_id} START`);
    
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
    console.log(`🔄 Refreshing tokens before API calls...`);
    try {
      const refreshedTokens = await googleService.refreshAccessToken(true); // Force refresh
      if (refreshedTokens) {
        console.log(`✅ Successfully refreshed tokens`);
        
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
      console.error(`❌ Token refresh failed:`, refreshError);
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
      
      // **REMOVED: Emergency limit check - processing all organizations regardless of size**
      console.log(`[Users ${sync_id}] Processing ${users.length} users for large organization...`);
      
      // Log resource usage after fetching
      monitor.logResourceUsage(`Users ${sync_id} FETCH COMPLETE`);
    } catch (error: any) {
      console.error(`[Users ${sync_id}] Error fetching users:`, error);
      
      // If user fetch fails, it's likely a token or permission issue
      const errorMessage = error.message.includes('Invalid Credentials') 
        ? 'Google authentication credentials are invalid. Please re-authenticate your Google Workspace account.'
        : `User fetch failed: ${error.message}`;
        
      await updateSyncStatus(sync_id, 0, errorMessage, 'FAILED'); // Use 0 instead of -1
      throw new Error(errorMessage);
    }
    
    await updateSyncStatus(sync_id, 20, `Processing ${users.length} users with resource-aware batching`);
    
    // **NEW: Process users with resource-aware batching**
    console.log(`[Users ${sync_id}] Processing ${users.length} users with resource-aware batching`);
    
    let processedCount = 0;
    
    await processInBatchesWithResourceControl(
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
        if (processedCount % 50 === 0 || processedCount === users.length) {
          const progress = 20 + Math.floor((processedCount / users.length) * 10);
          await updateSyncStatus(sync_id, progress, `Processed ${processedCount}/${users.length} users with resource monitoring`);
        }

        // Process this batch with optimized database operations
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

          // Update existing users with resource-aware processing
          if (usersToUpdate.length > 0) {
            // Determine update batch size based on current resources
            const usage = monitor.getCurrentUsage();
            const memoryRatio = Math.max(usage.heapUsed / 1600, usage.rss / 1600);
            const updateBatchSize = memoryRatio > 0.7 ? 3 : memoryRatio > 0.5 ? 5 : 8;
            
            for (let i = 0; i < usersToUpdate.length; i += updateBatchSize) {
              const updateBatch = usersToUpdate.slice(i, i + updateBatchSize);
              
              // Process updates individually to avoid conflicts
              const updatePromises = updateBatch.map(async (user) => {
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
                  }
                } catch (userUpdateError) {
                  console.error(`Error updating individual user ${user.email}:`, userUpdateError);
                }
              });
              
              // Wait for this update batch to complete
              await Promise.all(updatePromises);
              
              // Small delay between update sub-batches if resources are constrained
              if (memoryRatio > 0.5 && i + updateBatchSize < usersToUpdate.length) {
                await sleep(memoryRatio > 0.7 ? 150 : 75);
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
      `Users ${sync_id}`,
      30, // Base batch size - will be adjusted by resource monitor
      100 // Base delay - will be adjusted by resource monitor
    );
    
    await updateSyncStatus(sync_id, 30, `User sync completed - processed ${users.length} users with resource optimization`);
    
    // Log final resource usage
    monitor.logResourceUsage(`Users ${sync_id} COMPLETE`);
    
    console.log(`[Users ${sync_id}] User processing completed successfully`);
    
  } catch (error: any) {
    console.error(`[Users ${sync_id}] Error in user processing:`, error);
    
    // Log resource usage on error
    monitor.logResourceUsage(`Users ${sync_id} ERROR`);
    
    throw error;
  }
} 