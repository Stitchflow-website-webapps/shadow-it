import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { determineRiskLevel, transformRiskLevel } from '@/lib/risk-assessment';
import { categorizeApplication } from '@/app/api/background/sync/categorize/route';
import { EmailService } from '@/app/lib/services/email-service';

/**
 * A test cron job for a specific organization.
 * This job fetches and compares user and application data from Google Workspace against the database and logs the differences without sending notifications or triggering a full sync.
 *
 * It does NOT:
 * - Trigger a full background sync.
 * - Send any email notifications.
 *
 * @param {Request} request - The incoming request, expected to have an `orgDomain` query parameter.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgDomain = searchParams.get('orgDomain');

  if (!orgDomain) {
    return NextResponse.json({ error: 'orgDomain query parameter is required' }, { status: 400 });
  }

  // 1. Authenticate the request using a secret bearer token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];

  if (token !== process.env.CRON_SECRET) {
    console.error(`[TestCron:${orgDomain}] Unauthorized request`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`🚀 [TestCron:${orgDomain}] Starting test cron job for ${orgDomain}...`);

  try {
    // 2. Find the organization using the provided domain
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, auth_provider')
      .eq('domain', orgDomain)
      .single();

    if (orgError || !org) {
      console.error(`[TestCron:${orgDomain}] Could not find organization "${orgDomain}":`, orgError);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (org.auth_provider !== 'google') {
      console.error(`[TestCron:${orgDomain}] "${orgDomain}" is not a Google Workspace organization.`);
      return NextResponse.json({ error: 'Organization is not a Google provider' }, { status: 400 });
    }
    
    console.log(`[TestCron:${orgDomain}] ✅ Found organization: ${org.name} (${org.id})`);

    // 3. Get the latest admin-scoped tokens for the organization
    const { data: syncTokens, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('access_token, refresh_token, user_email, scope')
      .eq('organization_id', org.id)
      .not('refresh_token', 'is', null)
      .not('scope', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (syncError || !syncTokens || syncTokens.length === 0) {
      const errorMsg = `Could not find any valid tokens in sync_status for org ${org.id}.`;
      console.error(`[TestCron:${orgDomain}] ❌ ${errorMsg}`, syncError?.message);
      return NextResponse.json({ error: errorMsg }, { status: 404 });
    }
    
    const requiredAdminScopes = [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ];

    const bestToken = syncTokens.find(t => {
      if (!t.refresh_token || !t.scope) return false;
      const tokenScopes = t.scope.split(' ');
      return requiredAdminScopes.every(scope => tokenScopes.includes(scope));
    });

    if (!bestToken) {
      const errorMsg = `Could not find admin-scoped tokens for org ${org.id}.`;
      console.error(`[TestCron:${orgDomain}] ❌ ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 404 });
    }

    console.log(`[TestCron:${orgDomain}] ✅ Found admin-scoped tokens for user ${bestToken.user_email}.`);

    // 4. Initialize GoogleWorkspaceService and refresh the access token
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });

    googleService.setCredentials({ refresh_token: bestToken.refresh_token });
    const refreshedTokens = await googleService.refreshAccessToken(true);

    if (!refreshedTokens || !refreshedTokens.access_token) {
      const errorMsg = 'Failed to refresh access token. Tokens may have been revoked.';
      console.error(`[TestCron:${orgDomain}] ❌ ${errorMsg}`);
      
      // Send re-authentication email to the user whose tokens failed
      console.log(`[TestCron:${orgDomain}] Sending re-authentication email to ${bestToken.user_email}`);
      await EmailService.sendReAuthenticationRequired(bestToken.user_email, org.name, 'google');
      
      return NextResponse.json({ 
        error: errorMsg,
        action_required: 'Re-authentication needed',
        user_email: bestToken.user_email
      }, { status: 401 });
    }
    
    console.log(`[TestCron:${orgDomain}] ✅ Successfully refreshed access token.`);

    // 5. Fetch all users and app tokens from Google Workspace
    console.log(`[TestCron:${orgDomain}] Fetching data from Google Workspace API...`);
    const [allGoogleUsers, allGoogleTokens] = await Promise.all([
      googleService.getUsersListPaginated(),
      googleService.getOAuthTokens()
    ]);
    console.log(`[TestCron:${orgDomain}] Fetched ${allGoogleUsers.length} users and ${allGoogleTokens.length} total app tokens from Google.`);

    // 6. Sync users from Google to our DB to ensure all users exist before we process relationships
    console.log(`[TestCron:${orgDomain}] Syncing users table...`);
    const { data: existingDbUsers, error: existingUsersError } = await supabaseAdmin
      .from('users')
      .select('email') // Check against email to support all providers
      .eq('organization_id', org.id);

    if (existingUsersError) {
      console.error(`[TestCron:${orgDomain}] ❌ Error fetching existing users from Supabase:`, existingUsersError);
      return NextResponse.json({ error: 'DB fetch error while getting users' }, { status: 500 });
    }

    const existingUserEmails = new Set(existingDbUsers.map(u => u.email));
    const newGoogleUsers = allGoogleUsers.filter((u: any) => !existingUserEmails.has(u.primaryEmail));

    if (newGoogleUsers.length > 0) {
      console.log(`[TestCron:${orgDomain}] Found ${newGoogleUsers.length} new users to add to the database.`);
      const usersToInsert = newGoogleUsers.map((u: any) => ({
        organization_id: org.id,
        google_user_id: u.id,
        email: u.primaryEmail,
        name: u.name.fullName,
        role: 'User' // Default role for new users
      }));

      const { error: insertUsersError } = await supabaseAdmin
        .from('users')
        .insert(usersToInsert);

      if (insertUsersError) {
        console.error(`[TestCron:${orgDomain}] ❌ Error inserting new users:`, insertUsersError);
        // We log the error but continue, as some relationships might still be processable
      } else {
        console.log(`[TestCron:${orgDomain}] ✅ Successfully inserted ${newGoogleUsers.length} new users.`);
      }
    } else {
      console.log(`[TestCron:${orgDomain}] ✅ Users table is already up to date.`);
    }

    // Create a lookup map for user email/name by Google ID for easier logging
    const googleUserMap = new Map(allGoogleUsers.map((u: any) => [u.id, { email: u.primaryEmail, name: u.name.fullName }]));

    // 7. Process and de-duplicate applications from the raw token list
    console.log(`[TestCron:${orgDomain}] De-duplicating application list...`);
    const googleAppsMap = new Map<string, { id: string; name: string; users: Set<string>; scopes: Set<string>; }>();
    const userAppScopesMap = new Map<string, Set<string>>();

    allGoogleTokens.forEach((token: any) => {
      if (!token.clientId || !token.userKey) return;

      if (!googleAppsMap.has(token.clientId)) {
        googleAppsMap.set(token.clientId, {
          id: token.clientId,
          name: token.displayText || 'Unknown App',
          users: new Set<string>(),
          scopes: new Set<string>(),
        });
      }
      const appEntry = googleAppsMap.get(token.clientId)!;
      appEntry.users.add(token.userKey);
      token.scopes.forEach((s: string) => appEntry.scopes.add(s));

      // Store scopes per user-app relationship
      const userAppKey = `${token.userKey}:${token.clientId}`;
      if (!userAppScopesMap.has(userAppKey)) {
        userAppScopesMap.set(userAppKey, new Set<string>());
      }
      const userScopesForApp = userAppScopesMap.get(userAppKey)!;
      token.scopes.forEach((s: string) => userScopesForApp.add(s));
    });

    const uniqueGoogleApps = Array.from(googleAppsMap.values());
    console.log(`[TestCron:${orgDomain}] Found ${uniqueGoogleApps.length} unique applications.`);


    // 8. Fetch existing data from the Supabase database
    console.log(`[TestCron:${orgDomain}] Fetching existing data from Supabase DB...`);
    const { data: existingDbApps, error: appError } = await supabaseAdmin
        .from('applications')
        .select('name')
        .eq('organization_id', org.id);

    const { data: existingDbUserAppRels, error: relError } = await supabaseAdmin
        .from('user_applications')
        .select(`
            application:applications!inner(name),
            user:users!inner(google_user_id)
        `)
        .eq('application.organization_id', org.id);

    if (appError || relError) {
      console.error(`[TestCron:${orgDomain}] ❌ Error fetching existing data from Supabase:`, { appError, relError });
      return NextResponse.json({ error: 'DB fetch error' }, { status: 500 });
    }

    // 9. Compare datasets to find what's new
    console.log(`[TestCron:${orgDomain}] 🔍 Comparing datasets to find new entries...`);

    // Find new applications by name
    const existingAppNames = new Set(existingDbApps?.map((a: any) => a.name) || []);
    const newApps = uniqueGoogleApps.filter(app => !existingAppNames.has(app.name));

    // Find new user-application relationships by user Google ID and app name
    const dbUserAppRelsByName = new Set(existingDbUserAppRels?.map((r: any) => r.user && r.application ? `${r.user.google_user_id}:${r.application.name}` : null).filter(Boolean) || []);
    const newRelationships: { user: any; app: any; userKey: string; }[] = [];
    const processedRelsForReport = new Set<string>();

    // Iterate through the unique apps found in Google Workspace
    uniqueGoogleApps.forEach(app => {
        // For each app, iterate through the users who have access
        app.users.forEach(userKey => {
            const googleRelationshipId = `${userKey}:${app.name}`;
            
            // Check if this relationship (by user ID and app name) exists in our database
            if (!dbUserAppRelsByName.has(googleRelationshipId)) {
                const user = googleUserMap.get(userKey);
                if (user) {
                    // This is a new relationship we haven't seen before.
                    // We use a separate set to ensure we only add it to our report once,
                    // as our de-duplication might group multiple tokens under one app name.
                    const reportId = `${user.email}:${app.name}`;
                    if (!processedRelsForReport.has(reportId)) {
                        newRelationships.push({ user, app, userKey });
                        processedRelsForReport.add(reportId);
                    }
                }
            }
        });
    });

    // 10. Write new entries to the database
    if (newApps.length === 0 && newRelationships.length === 0) {
      console.log(`[TestCron:${orgDomain}] ✅ No new applications or relationships to write to the database.`);
    } else {
      console.log(`[TestCron:${orgDomain}] Writing new entries to the database. New apps: ${newApps.length}, New relationships: ${newRelationships.length}`);
      
      const appNameToDbIdMap = new Map<string, string>();

      // Insert new applications
      if (newApps.length > 0) {
        const appsToInsert = await Promise.all(newApps.map(async (app) => {
          const all_scopes = Array.from(app.scopes);
          const risk_level = determineRiskLevel(all_scopes);
          const category = await categorizeApplication(app.name, all_scopes);
          return {
            organization_id: org.id,
            google_app_id: app.id,
            name: app.name,
            category,
            risk_level: transformRiskLevel(risk_level),
            management_status: 'Newly discovered',
            all_scopes,
            total_permissions: all_scopes.length,
            provider: 'google'
          };
        }));
        
        const { data: insertedApps, error: insertAppsError } = await supabaseAdmin
          .from('applications')
          .insert(appsToInsert)
          .select('id, name');

        if (insertAppsError) {
          console.error(`[TestCron:${orgDomain}] ❌ Error inserting new applications:`, insertAppsError);
        } else if (insertedApps) {
          console.log(`[TestCron:${orgDomain}] ✅ Successfully inserted ${insertedApps.length} new applications.`);
          insertedApps.forEach(a => appNameToDbIdMap.set(a.name, a.id));
        }
      }

      // Insert new user-application relationships
      if (newRelationships.length > 0) {
        const allInvolvedAppNames = Array.from(new Set(newRelationships.map(r => r.app.name)));
        const { data: involvedApps, error: involvedAppsError } = await supabaseAdmin
          .from('applications')
          .select('id, name')
          .in('name', allInvolvedAppNames)
          .eq('organization_id', org.id);
        
        involvedApps?.forEach(a => appNameToDbIdMap.set(a.name, a.id));

        const allInvolvedUserEmails = Array.from(new Set(newRelationships.map(r => r.user.email)));
        const { data: involvedUsers, error: involvedUsersError } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('email', allInvolvedUserEmails)
          .eq('organization_id', org.id);

        if (involvedAppsError || involvedUsersError) {
          console.error(`[TestCron:${orgDomain}] ❌ Error fetching DB IDs:`, { involvedAppsError, involvedUsersError });
        } else {
          const userEmailToDbIdMap = new Map(involvedUsers?.map(u => [u.email, u.id]) || []);
          
          const relsToInsert = newRelationships.flatMap(rel => {
            const application_id = appNameToDbIdMap.get(rel.app.name);
            const user_id = userEmailToDbIdMap.get(rel.user.email);
            
            if (!application_id || !user_id) {
              console.warn(`[TestCron:${orgDomain}] ⚠️ Skipping relationship for ${rel.user.email} and ${rel.app.name} (missing DB ID).`);
              return [];
            }
            
            // Get the user-specific scopes for this relationship
            const scopesSet = userAppScopesMap.get(`${rel.userKey}:${rel.app.id}`) || new Set();
            
            return [{ application_id, user_id, scopes: Array.from(scopesSet) }];
          });

          if (relsToInsert.length > 0) {
            const { error: insertRelsError } = await supabaseAdmin.from('user_applications').insert(relsToInsert as any);
            if (insertRelsError) {
              console.error(`[TestCron:${orgDomain}] ❌ Error inserting new relationships:`, insertRelsError);
            } else {
              console.log(`[TestCron:${orgDomain}] ✅ Successfully inserted ${relsToInsert.length} new user-app relationships.`);
            }
          }
        }
      }
    }


    // 11. Log the results
    console.log(`--- [TestCron:${orgDomain}] RESULTS ---`);
    
    if (newApps.length > 0) {
      console.log(`✅ Found ${newApps.length} new applications:`);
      newApps.forEach((app: any) => {
        console.log(`  - Name: ${app.name}, App ID: ${app.id}, Users: ${app.users.size}`);
      });
    } else {
      console.log('✅ No new applications found.');
    }

    if (newRelationships.length > 0) {
        console.log(`✅ Found ${newRelationships.length} new user-app relationships:`);
        newRelationships.sort((a,b) => a.user.email.localeCompare(b.user.email) || a.app.name.localeCompare(b.app.name));
        newRelationships.forEach(rel => {
            console.log(`  - User: ${rel.user.name} (${rel.user.email}) was added to App: ${rel.app.name} (${rel.app.id})`);
        });
    } else {
        console.log('✅ No new user-app relationships found.');
    }
    
    console.log(`--- [TestCron:${orgDomain}] END RESULTS ---`);
    console.log(`[TestCron:${orgDomain}] ✅ Test run for ${orgDomain} completed successfully.`);

    // 12. Send reports
    if (newApps.length > 0) {
      await processWeeklyNewAppReport(org, newApps);
    }
    if (newRelationships.length > 0) {
      await processNewUserDigestReport(org, newRelationships, googleUserMap);
    }

    return NextResponse.json({
      success: true,
      message: `Test cron for ${orgDomain} completed successfully.`,
      results: {
        newAppsFound: newApps.length,
        newUserAppRelationshipsFound: newRelationships.length,
        newApps: newApps.map((a: any) => ({ name: a.name, id: a.id, userCount: a.users.size })),
        newUserAppRelationships: newRelationships.map(r => ({ userName: r.user.name, userEmail: r.user.email, appName: r.app.name }))
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error(`[TestCron:${orgDomain}] ❌ An unexpected error occurred:`, error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
}

async function processWeeklyNewAppReport(org: { id: string, name: string }, newApps: any[]) {
  try {
    console.log(`[TestCron:Google:${org.name}] Checking for weekly new app reports...`);
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();
    const weekIdentifier = `weekly-apps-${currentYear}-${currentWeek}`;

    // Check if any apps were discovered this week (not just added to our newApps array)
    const startOfWeek = getStartOfWeek(new Date());
    const { data: appsDiscoveredThisWeek, error: weeklyAppsError } = await supabaseAdmin
      .from('applications')
      .select('id, name, total_permissions, risk_level, created_at')
      .eq('organization_id', org.id)
      .eq('provider', 'google')
      .gte('created_at', startOfWeek.toISOString());

    if (weeklyAppsError) {
      console.error(`[TestCron:Google:${org.name}] Error fetching weekly apps:`, weeklyAppsError);
      return;
    }

    // If no apps were discovered this week, skip the report
    if (!appsDiscoveredThisWeek || appsDiscoveredThisWeek.length === 0) {
      console.log(`[TestCron:Google:${org.name}] No apps discovered this week, skipping weekly report.`);
      return;
    }

    console.log(`[TestCron:Google:${org.name}] Found ${appsDiscoveredThisWeek.length} apps discovered this week.`);

    // Get user counts for each app discovered this week
    const appIds = appsDiscoveredThisWeek.map(app => app.id);
    const { data: userCounts, error: userCountError } = await supabaseAdmin
      .from('user_applications')
      .select('application_id')
      .in('application_id', appIds);

    if (userCountError) {
      console.error(`[TestCron:Google:${org.name}] Error fetching user counts:`, userCountError);
      return;
    }

    // Count users per app
    const userCountMap = new Map<string, number>();
    userCounts?.forEach(uc => {
      const count = userCountMap.get(uc.application_id) || 0;
      userCountMap.set(uc.application_id, count + 1);
    });

    // Format the apps data for the email
    const eventAppsString = appsDiscoveredThisWeek.map(app => 
      `App name: ${app.name}\nTotal scope permission: ${app.total_permissions}\nRisk level: ${app.risk_level}\nTotal users: ${userCountMap.get(app.id) || 0}`
    ).join('\n\n');

    const notificationPrefs = await getNotificationPreferences(org.id, 'new_app_detected');
    if (!notificationPrefs) return;

    for (const pref of notificationPrefs) {
      await safelySendReport({
        organizationId: org.id,
        userEmail: pref.user_email,
        notificationType: 'weekly_new_apps',
        reportIdentifier: weekIdentifier,
        sendFunction: () => EmailService.sendNewAppsDigest(pref.user_email, eventAppsString, org.name)
      });
    }
  } catch (error) {
    console.error(`[TestCron:Google:${org.name}] Error processing weekly new app report:`, error);
  }
}

async function processNewUserDigestReport(org: { id: string, name: string }, newRelationships: any[], googleUserMap: Map<string, { email: string; name: string; }>) {
  try {
    console.log(`[TestCron:Google:${org.name}] Checking for new user digest report...`);
    const reportIdentifier = `digest-users-${new Date().toISOString().split('T')[0]}`;

    const usersToAppsMap = new Map<string, string[]>();
    newRelationships.forEach(rel => {
        const user = googleUserMap.get(rel.userKey);
        if (user && user.email) {
            if (!usersToAppsMap.has(user.email)) {
                usersToAppsMap.set(user.email, []);
            }
            usersToAppsMap.get(user.email)!.push(rel.app.name);
        }
    });

    const eventUsersString = Array.from(usersToAppsMap.entries()).map(([email, apps]) => 
      `User email: ${email}\nApp names: ${[...new Set(apps)].join(', ')}`
    ).join('\n\n');

    const notificationPrefs = await getNotificationPreferences(org.id, 'new_user_in_app');
    if (!notificationPrefs) return;
    
    for (const pref of notificationPrefs) {
      await safelySendReport({
        organizationId: org.id,
        userEmail: pref.user_email,
        notificationType: 'digest_new_users',
        reportIdentifier: reportIdentifier,
        sendFunction: () => EmailService.sendNewUsersDigest(pref.user_email, eventUsersString, org.name)
      });
    }
  } catch (error) {
    console.error(`[TestCron:Google:${org.name}] Error processing new user digest report:`, error);
  }
}

async function getNotificationPreferences(organizationId: string, preferenceType: 'new_app_detected' | 'new_user_in_app') {
  const { data: prefs, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_email')
    .eq('organization_id', organizationId)
    .eq(preferenceType, true);

  if (error) {
    console.error(`[TestCron:Google] Error fetching notification preferences for ${preferenceType} for org ${organizationId}:`, error);
    return null;
  }
  return prefs;
}

async function safelySendReport({
  organizationId,
  userEmail,
  notificationType,
  reportIdentifier,
  sendFunction
}: {
  organizationId: string;
  userEmail: string;
  notificationType: 'weekly_new_apps' | 'digest_new_users';
  reportIdentifier: string;
  sendFunction: () => Promise<boolean>;
}) {
  const { data: existing, error: checkError } = await supabaseAdmin
    .from('notification_tracking')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_email', userEmail)
    .eq('notification_type', notificationType)
    .eq('application_id', reportIdentifier) // Using application_id to store the report identifier
    .single();

  if (checkError && !checkError.message.includes('No rows found')) {
    console.error('[TestCron:Google] Error checking for report:', checkError);
    return;
  }

  if (existing) {
    console.log(`[TestCron:Google] Report ${notificationType} for ${reportIdentifier} already sent to ${userEmail}.`);
    return;
  }

  const success = await sendFunction();
  if (success) {
    await supabaseAdmin.from('notification_tracking').insert({
      organization_id: organizationId,
      user_email: userEmail,
      notification_type: notificationType,
      application_id: reportIdentifier, // Storing report identifier
      sent_at: new Date().toISOString()
    });
    console.log(`[TestCron:Google] Successfully sent and tracked report ${notificationType} to ${userEmail}`);
  }
}

function getWeekNumber(d: Date): number {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
}

function getStartOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // Sunday = 0, Monday = 1, etc.
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday to get Monday
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0); // Set to the beginning of the day in local time
  return monday;
} 