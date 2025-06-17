import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { EmailService } from '@/app/lib/services/email-service';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { determineRiskLevel } from '@/lib/risk-assessment';

// Helper function to safely refresh OAuth tokens with retry logic
async function safelyRefreshTokens(
  service: GoogleWorkspaceService | MicrosoftWorkspaceService, 
  syncId: string, 
  orgId: string,
  provider: string
) {
  const maxRetries = 3;
  let attemptCount = 0;
  
  while (attemptCount < maxRetries) {
    try {
      attemptCount++;
      console.log(`[${provider}] Attempting token refresh (attempt ${attemptCount}/${maxRetries}) for org ${orgId}...`);
      
      // Force token refresh
      const refreshedTokens = await service.refreshAccessToken(true);
      
      if (!refreshedTokens) {
        throw new Error(`No ${provider} tokens returned from refresh`);
      }
      
      console.log(`[${provider}] Successfully refreshed tokens for org ${orgId}`);
      return refreshedTokens;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${provider}] Error refreshing tokens (attempt ${attemptCount}/${maxRetries}):`, errorMessage);
      
      if (attemptCount >= maxRetries) {
        console.error(`[${provider}] Max retry attempts reached, giving up token refresh for org ${orgId}`);
        
        // Record the failure in the database
        try {
          await supabaseAdmin
            .from('sync_status')
            .insert({
              organization_id: orgId,
              status: 'FAILED',
              error_message: `${provider} token refresh failed after ${maxRetries} attempts: ${errorMessage}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
        } catch (dbError) {
          console.error(`[${provider}] Failed to record token refresh failure in database:`, dbError);
        }
        
        throw error; // Re-throw the original error
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attemptCount) * 1000; // 2s, 4s, 8s
      console.log(`[${provider}] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error(`Failed to refresh ${provider} tokens after ${maxRetries} attempts`);
}

/**
 * Helper function that safely checks if a notification has already been sent
 * and only sends a new notification if one hasn't been sent before
 */
async function safelySendNotification({
  organizationId,
  userEmail,
  applicationId,
  notificationType,
  sendFunction
}: {
  organizationId: string;
  userEmail: string;
  applicationId: string;
  notificationType: 'new_app' | 'new_user' | 'new_user_review';
  sendFunction: () => Promise<boolean>;
}) {
  try {
    console.log(`Checking if notification type=${notificationType} for app=${applicationId} to user=${userEmail} has already been sent...`);
    
    // First check if notification has already been sent using a transaction
    const { data: notificationExists, error: checkError } = await supabaseAdmin
      .from('notification_tracking')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_email', userEmail)
      .eq('application_id', applicationId)
      .eq('notification_type', notificationType)
      .single();
    
    if (checkError && !checkError.message.includes('No rows found')) {
      // Only report errors that aren't "no rows found"
      console.error(`Error checking notification tracking:`, checkError);
    }
    
    // If notification already exists, don't send again
    if (notificationExists) {
      console.log(`Notification already sent to ${userEmail} for app ${applicationId} (type: ${notificationType})`);
      return false;
    }
    
    console.log(`No existing notification found, proceeding to send...`);
    
    // Create a record BEFORE sending the notification to prevent race conditions
    const { error: insertError } = await supabaseAdmin
      .from('notification_tracking')
      .insert({
        organization_id: organizationId,
        user_email: userEmail,
        application_id: applicationId,
        notification_type: notificationType,
        sent_at: new Date().toISOString()
      });
    
    if (insertError) {
      console.error('Error inserting notification tracking record:', insertError);
      return false;
    }
    
    // Now send the actual notification
    const success = await sendFunction();
    
    if (success) {
      console.log(`Successfully sent ${notificationType} notification to ${userEmail}`);
      return true;
    } else {
      console.log(`Failed to send ${notificationType} notification to ${userEmail}`);
      return false;
    }
  } catch (error) {
    console.error(`Error in safelySendNotification:`, error);
    return false;
  }
}

// Removed edge runtime for Render compatibility
// export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    // Authenticate the request
    // This is a simple check based on a bearer token
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    
    if (token !== process.env.CRON_SECRET) {
      console.error('Unauthorized cron job request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, google_org_id, auth_provider');

    if (orgError) {
      console.error('Error fetching organizations:', orgError);
      return NextResponse.json({ error: 'Error fetching organizations' }, { status: 500 });
    }

    if (!organizations || organizations.length === 0) {
      console.log('No organizations found to process');
      return NextResponse.json({ message: 'No organizations to process' });
    }

    // to a direct API call for notification processing
    const isNotificationOnlyMode = request.headers.get('X-Notification-Only') === 'true';

    if (isNotificationOnlyMode) {
      console.log('Running in notification-only mode, skipping sync triggers.');
    } else {
      // For each organization, trigger the main background sync
      for (const org of organizations) {
        console.log(`🚀 Processing organization: ${org.id} (${org.name})`);

        if (org.auth_provider === 'google' || org.auth_provider === 'microsoft') {
          await triggerBackgroundSync(org, org.auth_provider);
        } else {
          console.log(`⏭️ Skipping organization ${org.id} with unknown provider: ${org.auth_provider}`);
        }

        // Add a small delay to stagger the start of each sync and avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay
      }
    }

    // After triggering syncs (or in notification-only mode), process notifications for recent events.
    console.log('🔄 Starting notification processing for all organizations...');
    try {
      await processNewAppNotifications();
      await processNewUserNotifications();
      await processNewUserReviewNotifications();
      console.log('✅ Successfully processed all notifications.');
    } catch (error) {
      console.error('❌ Error during notification processing:', error);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Syncs triggered and notifications checked'
    });
  } catch (error) {
    console.error('Error in notification check cron job:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Triggers the main background sync process for a given organization.
 * This is a fire-and-forget operation.
 */
async function triggerBackgroundSync(org: any, provider: 'google' | 'microsoft') {
  try {
    console.log(`⚙️ Triggering background sync for ${provider} org ${org.id}...`);

    // Get the latest sync record to retrieve the most recent admin-scoped tokens
    const { data: latestSync, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('access_token, refresh_token, user_email, scope')
      .eq('organization_id', org.id)
      .not('refresh_token', 'is', null) // Ensure we have a refresh token
      .not('scope', 'is', null) // Ensure we have scopes
      .order('created_at', { ascending: false })
      .limit(10); // Get multiple records to find the best one

    if (syncError || !latestSync || latestSync.length === 0) {
      console.error(`❌ Could not find any tokens in sync_status for ${provider} org ${org.id}. Error:`, syncError?.message);
      console.error(`This indicates the user hasn't completed the admin consent flow properly.`);
      return;
    }

    // Find the best admin-scoped token from the results
    const requiredAdminScopes = [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ];

    let bestToken = null;
    for (const token of latestSync) {
      if (!token.refresh_token || !token.access_token) continue;
      
      // Check if this token has admin scopes
      const tokenScopes = token.scope ? token.scope.split(' ') : [];
      const hasRequiredAdminScopes = requiredAdminScopes.every(scope => 
        tokenScopes.includes(scope)
      );
      
      if (hasRequiredAdminScopes) {
        bestToken = token;
        break; // Found admin-scoped token, use it
      }
    }

    if (!bestToken) {
      console.error(`❌ Could not find admin-scoped tokens in sync_status for ${provider} org ${org.id}.`);
      console.error(`Available tokens:`, latestSync.map(t => ({
        hasRefresh: !!t.refresh_token,
        hasAccess: !!t.access_token,
        scopes: t.scope
      })));
      console.error(`This indicates the user hasn't completed the admin consent flow properly.`);
      return;
    }

    console.log(`✅ Found admin-scoped tokens in sync_status for ${provider} org ${org.id}`, {
      hasRefresh: !!bestToken.refresh_token,
      hasAccess: !!bestToken.access_token,
      scopes: bestToken.scope
    });

    // 2. Create a new sync_status record for this cron-triggered run
    const { data: newSyncStatus, error: createError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: org.id,
        user_email: bestToken.user_email,
        status: 'IN_PROGRESS',
        progress: 5,
        message: `Daily background sync initiated by cron for ${provider}.`,
        provider: provider,
        access_token: bestToken.access_token,
        refresh_token: bestToken.refresh_token,
      })
      .select('id')
      .single();

    if (createError) {
      console.error(`❌ Failed to create new sync status for cron run (org ${org.id}):`, createError);
      return;
    }

    const sync_id = newSyncStatus.id;
    console.log(`✅ Created new sync record ${sync_id} for org ${org.id}.`);

    // 3. Get base URL for the internal API call
    const baseUrl = "https://www.stitchflow.com/tools/shadow-it-scan"

    const syncUrl = `${baseUrl}/api/background/sync`;

    // 4. Fire-and-forget the sync process. The cron job's task is just to kick it off.
    fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        organization_id: org.id,
        sync_id: sync_id,
        access_token: bestToken.access_token,
        refresh_token: bestToken.refresh_token,
        provider: provider,
      }),
    }).catch(fetchError => {
      console.error(`❌ Fetch error triggering background sync for org ${org.id}:`, fetchError);
      // If the fetch itself fails, mark the sync as failed.
      supabaseAdmin
        .from('sync_status')
        .update({ status: 'FAILED', message: `Cron failed to trigger sync endpoint: ${fetchError.message}` })
        .eq('id', sync_id);
    });

    console.log(`▶️ Successfully dispatched sync request for ${provider} org ${org.id}.`);

  } catch (error) {
    console.error(`❌ Error in triggerBackgroundSync for org ${org.id}:`, error);
  }
}

async function processNewAppNotifications() {
  try {
    console.log('Checking for new app notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Check how many syncs have completed for this organization
      const { count, error: countError } = await supabaseAdmin
        .from('sync_status')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('status', 'COMPLETED');

      if (countError) {
        console.error(`Error checking sync status count for org ${org.id}:`, countError);
        continue; // Skip this organization on error
      }
      
      // If there has been less than one completed sync, it's likely the first run.
      // Skip new app notifications to avoid flooding users after initial setup.
      // We check for < 2 because the first sync should complete before we consider sending notifications.
      if (count === null || count < 2) {
        console.log(`Skipping new app notifications for org ${org.id} as it has had ${count} completed syncs. Waiting for at least 2 completed syncs.`);
        continue;
      }
      
      // Get all applications created recently (within the last 24 hours)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newApps, error: appsError } = await supabaseAdmin
        .from('applications')
        .select('*')
        .eq('organization_id', org.id)
        .gte('created_at', oneDayAgo.toISOString());
      
      if (appsError) {
        console.error(`Error fetching new apps for org ${org.id}:`, appsError);
        continue;
      }

      if (!newApps || newApps.length === 0) {
        console.log(`No new apps found for organization ${org.id}`);
        continue;
      }

      console.log(`Found ${newApps.length} new apps for org ${org.id}`);
      
      // Get users who should be notified (have new_app_detected = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_app_detected', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new app notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new app, send notifications to eligible users
      for (const app of newApps) {
        // Process each user who has notifications enabled
        for (const pref of notificationPrefs) {
          console.log(`Processing notification for ${pref.user_email} for new app ${app.name}`);
          
          // Use the new helper function to safely send notification
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: app.id,
            notificationType: 'new_app',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewAppNotification({
                  to: pref.user_email,
                  appName: app.name,
                  organizationName: org.name,
                  detectionTime: app.created_at,
                  riskLevel: app.risk_level,
                  category: app.category || 'Uncategorized',
                  userCount: app.user_count,
                  totalPermissions: app.total_permissions
                });
                
                console.log(`Successfully sent new app notification to ${pref.user_email} for ${app.name}`);
                return true; // Indicate success
              } catch (error) {
                console.error(`Error sending notification to ${pref.user_email}:`, error);
                return false; // Indicate failure
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new app notifications check');
  } catch (error) {
    console.error('Error processing new app notifications:', error);
    throw error;
  }
}

async function processNewUserNotifications() {
  try {
    console.log('Checking for new user notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Get all user-application relationships created in the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newUserApps, error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          *,
          user:users!inner (id, email, name),
          application:applications!inner (id, name, organization_id, risk_level, category, total_permissions)
        `)
        .gte('created_at', oneDayAgo.toISOString());
      
      if (userAppError) {
        console.error(`Error fetching new user-app relationships:`, userAppError);
        continue;
      }
      
      if (!newUserApps || newUserApps.length === 0) {
        console.log(`No new user-app relationships found for organization ${org.id}`);
        continue;
      }
      
      // Filter to only include this organization's applications
      const orgUserApps = newUserApps.filter(ua => ua.application.organization_id === org.id);
      
      if (orgUserApps.length === 0) {
        console.log(`No new user-app relationships for this organization`);
        continue;
      }
      
      console.log(`Found ${orgUserApps.length} new user-app relationships for org ${org.id}`);
      
      // Get users who should be notified (have new_user_in_app = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_user_in_app', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new user notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new user-app relationship, send notifications to eligible users
      for (const userApp of orgUserApps) {
        // Process notifications for each eligible user
        for (const pref of notificationPrefs) {
          console.log(`Processing notification to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
          
          // Use the safe notification helper
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: userApp.application.id,
            notificationType: 'new_user',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewUserNotification({
                  to: pref.user_email,
                  appName: userApp.application.name,
                  userName: userApp.user.name || userApp.user.email,
                  organizationName: org.name,
                  riskLevel: userApp.application.risk_level,
                  category: userApp.application.category || 'Uncategorized',
                  totalPermissions: userApp.application.total_permissions
                });
                
                console.log(`Successfully sent new user notification to ${pref.user_email}`);
                return true;
              } catch (error) {
                console.error(`Error sending notification to ${pref.user_email}:`, error);
                return false;
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new user notifications check');
  } catch (error) {
    console.error('Error processing new user notifications:', error);
    throw error;
  }
}

async function processNewUserReviewNotifications() {
  try {
    console.log('Checking for new user in review app notifications...');

    // Get all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name');

    if (orgError) {
      throw orgError;
    }

    for (const org of organizations) {
      console.log(`Processing organization: ${org.id}`);
      
      // Get all user-application relationships created in the last 24 hours for 'Needs Review' apps
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const { data: newUserReviewApps, error: userAppError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          *,
          user:users!inner (id, email, name),
          application:applications!inner (id, name, organization_id, risk_level, category, total_permissions, management_status)
        `)
        .gte('created_at', oneDayAgo.toISOString())
        .eq('application.management_status', 'Needs Review');
      
      if (userAppError) {
        console.error(`Error fetching new user-app relationships for review apps:`, userAppError);
        continue;
      }
      
      if (!newUserReviewApps || newUserReviewApps.length === 0) {
        console.log(`No new user-app relationships found for review apps in organization ${org.id}`);
        continue;
      }
      
      // Filter to only include this organization's applications
      const orgUserReviewApps = newUserReviewApps.filter(ua => ua.application.organization_id === org.id);
      
      if (orgUserReviewApps.length === 0) {
        console.log(`No new user-review app relationships for this organization`);
        continue;
      }
      
      console.log(`Found ${orgUserReviewApps.length} new user-review app relationships for org ${org.id}`);
      
      // Get users who should be notified (have new_user_in_review_app = true)
      const { data: notificationPrefs, error: prefsError } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('organization_id', org.id)
        .eq('new_user_in_review_app', true);
      
      if (prefsError) {
        console.error(`Error fetching notification preferences for org ${org.id}:`, prefsError);
        continue;
      }
      
      if (!notificationPrefs || notificationPrefs.length === 0) {
        console.log(`No users with new user in review app notifications enabled for org ${org.id}`);
        continue;
      }
      
      // For each new user-review app relationship, send notifications to eligible users
      for (const userApp of orgUserReviewApps) {
        // Process notifications for each eligible user
        for (const pref of notificationPrefs) {
          console.log(`Processing review notification to ${pref.user_email} for user ${userApp.user.email} in app ${userApp.application.name}`);
          
          // Use the safe notification helper
          await safelySendNotification({
            organizationId: org.id,
            userEmail: pref.user_email,
            applicationId: userApp.application.id,
            notificationType: 'new_user_review',
            sendFunction: async () => {
              try {
                // Send the email notification
                await EmailService.sendNewUserReviewNotification({
                  to: pref.user_email,
                  appName: userApp.application.name,
                  userName: userApp.user.name || userApp.user.email,
                  organizationName: org.name,
                  riskLevel: userApp.application.risk_level,
                  category: userApp.application.category || 'Uncategorized',
                  totalPermissions: userApp.application.total_permissions
                });
                
                console.log(`Successfully sent review notification to ${pref.user_email}`);
                return true;
              } catch (error) {
                console.error(`Error sending review notification to ${pref.user_email}:`, error);
                return false;
              }
            }
          });
        }
      }
    }
    
    console.log('Completed new user in review app notifications check');
  } catch (error) {
    console.error('Error processing new user in review app notifications:', error);
    throw error;
  }
}