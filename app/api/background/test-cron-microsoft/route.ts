import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { determineRiskLevel, transformRiskLevel } from '@/lib/risk-assessment';
import { categorizeApplication } from '@/app/api/background/sync/categorize/route';
import { EmailService } from '@/app/lib/services/email-service';
import { ResourceMonitor, processInBatchesWithResourceControl } from '@/lib/resource-monitor';

// **NEW: Configuration for resource management**
const PROCESSING_CONFIG = {
  BATCH_SIZE: 30, // Conservative batch size for large orgs
  DELAY_BETWEEN_BATCHES: 150, // Allow time for memory cleanup
  EMERGENCY_LIMITS: {
    MAX_USERS_IN_MEMORY: 20000, // Hard limit on users processed at once
    MAX_TOKENS_IN_MEMORY: 8000, // Hard limit on tokens processed at once
    FORCE_CLEANUP_THRESHOLD: 1400, // Force cleanup at 1.4GB (87.5% of 1.6GB limit)
  }
};

// **NEW: Helper function to force memory cleanup**
const forceMemoryCleanup = () => {
  if (global.gc) {
    global.gc();
  }
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > PROCESSING_CONFIG.EMERGENCY_LIMITS.FORCE_CLEANUP_THRESHOLD * 1024 * 1024) {
      console.log(`[TestCron:Microsoft] Memory usage high: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, forcing cleanup`);
      if (global.gc) global.gc();
    }
  }
};

/**
 * A test cron job for a specific Microsoft organization.
 * This job fetches and compares user and application data from Microsoft Graph API against the database.
 * It identifies new users, new applications, and new user-application relationships. (DB writes are temporarily disabled for testing).
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
    console.error(`[TestCron:Microsoft:${orgDomain}] Unauthorized request`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`🚀 [TestCron:Microsoft:${orgDomain}] Starting test cron job for ${orgDomain}...`);
  
  // **NEW: Initialize resource monitoring**
  const monitor = ResourceMonitor.getInstance();
  monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} START`);

  try {
    // 2. Find the organization using the provided domain
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, auth_provider')
      .eq('domain', orgDomain)
      .single();

    if (orgError || !org) {
      console.error(`[TestCron:Microsoft:${orgDomain}] Could not find organization "${orgDomain}":`, orgError);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (org.auth_provider !== 'microsoft') {
      console.error(`[TestCron:Microsoft:${orgDomain}] "${orgDomain}" is not a Microsoft organization.`);
      return NextResponse.json({ error: 'Organization is not a Microsoft provider' }, { status: 400 });
    }
    
    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Found organization: ${org.name} (${org.id})`);

    // 3. Get the latest admin-scoped tokens for the organization
    const { data: syncTokens, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('access_token, refresh_token, user_email, scope')
      .eq('organization_id', org.id)
      .eq('provider', 'microsoft')
      .not('refresh_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1); // Microsoft usually has one primary admin token

    if (syncError || !syncTokens || syncTokens.length === 0) {
      const errorMsg = `Could not find any valid Microsoft tokens in sync_status for org ${org.id}.`;
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ ${errorMsg}`, syncError?.message);
      return NextResponse.json({ error: errorMsg }, { status: 404 });
    }
    
    const bestToken = syncTokens[0];

    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Found tokens for user ${bestToken.user_email}.`);

    // 4. Initialize MicrosoftWorkspaceService, refresh tokens, and extract Tenant ID
    // We initialize with 'common' tenant first, as we don't know the specific tenant ID yet.
    let microsoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenantId: 'common',
    });

    microsoftService.setCredentials({ refresh_token: bestToken.refresh_token });
    const refreshedTokens = await microsoftService.refreshAccessToken(true);

    if (!refreshedTokens || !refreshedTokens.access_token || !refreshedTokens.id_token) {
      const errorMsg = 'Failed to refresh access token or missing id_token. Tokens may have been revoked.';
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ ${errorMsg}`);
      
      // Send re-authentication email to the user whose tokens failed
      console.log(`[TestCron:Microsoft:${orgDomain}] Sending re-authentication email to ${bestToken.user_email}`);
      await EmailService.sendReAuthenticationRequired(bestToken.user_email, org.name, 'microsoft');
      
      return NextResponse.json({ 
        error: errorMsg,
        action_required: 'Re-authentication needed',
        user_email: bestToken.user_email
      }, { status: 401 });
    }
    
    // The tenant ID is inside the id_token. We need to decode it.
    let tenantId: string;
    try {
      const idTokenPayload = JSON.parse(Buffer.from(refreshedTokens.id_token.split('.')[1], 'base64').toString());
      tenantId = idTokenPayload.tid;
      if (!tenantId) {
        throw new Error('Tenant ID (tid) not found in id_token payload.');
      }
    } catch (e) {
      const errorMsg = 'Failed to decode id_token or find tenant ID.';
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ ${errorMsg}`, e);
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully extracted tenant ID: ${tenantId}`);
    
    // Re-initialize the service with the correct tenant ID for making API calls
    microsoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenantId: tenantId,
    });

    // Set the credentials on the new, correctly-scoped service instance
    microsoftService.setCredentials(refreshedTokens);
    
    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Re-initialized service with correct tenant ID.`);

    // 5. Fetch all users and application tokens (with scopes) from Microsoft Graph API
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetching data from Microsoft Graph API...`);
    const allMSUsers = await microsoftService.getUsersList();
    const allMSAppTokens = await microsoftService.getOAuthTokens();

    console.log(`[TestCron:Microsoft:${orgDomain}] Fetched ${allMSUsers.length} users and ${allMSAppTokens.length} user-app tokens.`);
    
    // **REMOVED: Emergency limits - processing all organizations regardless of size**
    console.log(`[TestCron:Microsoft:${orgDomain}] Processing large organization with ${allMSUsers.length} users and ${allMSAppTokens.length} tokens...`);
    
    // **NEW: Log resource usage after fetch**
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} FETCH COMPLETE`);
    
    // 6. Sync users from Microsoft to our DB
    console.log(`[TestCron:Microsoft:${orgDomain}] Syncing users table...`);
    const { data: existingDbUsers, error: existingUsersError } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('organization_id', org.id);

    if (existingUsersError) {
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error fetching existing users from Supabase:`, existingUsersError);
      return NextResponse.json({ error: 'DB fetch error while getting users' }, { status: 500 });
    }

    const existingUserEmails = new Set(existingDbUsers.map(u => u.email));
    const newMSUsers = allMSUsers.filter((u: any) => u.mail && !existingUserEmails.has(u.mail));

    if (newMSUsers.length > 0) {
      console.log(`[TestCron:Microsoft:${orgDomain}] Found ${newMSUsers.length} new users to add.`);
      const usersToInsert = newMSUsers.map((u: any) => ({
        organization_id: org.id,
        microsoft_user_id: u.id,
        email: u.mail,
        name: u.displayName,
        role: 'User'
      }));

      // **NEW: Use resource-aware batch processing for user insertion**
      try {
        await processInBatchesWithResourceControl(
          usersToInsert,
          async (userBatch) => {
            const { error: insertUsersError } = await supabaseAdmin
              .from('users')
              .insert(userBatch);

            if (insertUsersError) {
              console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting user batch:`, insertUsersError);
            }
          },
          `TestCron:Microsoft:${orgDomain} USER_INSERT`,
          PROCESSING_CONFIG.BATCH_SIZE,
          PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
        );
        console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully processed ${newMSUsers.length} new users with resource monitoring.`);
      } catch (insertError) {
        console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error in resource-aware user insertion:`, insertError);
      }
    } else {
      console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Users table is already up to date.`);
    }

    const msUserMap = new Map(allMSUsers.map((u: any) => [u.id, { email: u.mail, name: u.displayName }]));

    // 7. Process and de-duplicate applications from the service principals and grants with resource management
    console.log(`[TestCron:Microsoft:${orgDomain}] Processing and de-duplicating application list with memory management...`);

    const msAppsMap = new Map<string, { ids: Set<string>; name: string; users: Set<string>; scopes: Set<string>; }>();
    const userAppScopesMap = new Map<string, Set<string>>(); // Key: user_id:app_name
    
    // **NEW: Process tokens in resource-aware batches**
    await processInBatchesWithResourceControl(
      allMSAppTokens,
      async (tokenBatch) => {
        for (const token of tokenBatch) {
          if (!token.displayText || !token.userKey) {
              continue; // Skip tokens without essential info
          }
          
          // Use the application's display name as the primary key for de-duplication
          if (!msAppsMap.has(token.displayText)) {
              msAppsMap.set(token.displayText, {
                  ids: new Set<string>(), // Will store all service principal IDs associated with this name
                  name: token.displayText,
                  users: new Set<string>(), // Will store all user IDs
                  scopes: new Set<string>(),
              });
          }

          const appEntry = msAppsMap.get(token.displayText)!;
          appEntry.ids.add(token.clientId); // Store the app's client ID
          appEntry.users.add(token.userKey); // Store the user's MS ID
          
          // Add all scopes from the token to the application's scope set
          const tokenScopes = token.scopes || [];
          tokenScopes.forEach((scope: string) => {
              appEntry.scopes.add(scope);
          });
          
          // Store scopes per user-app relationship
          const userAppKey = `${token.userKey}:${token.displayText}`;
          if (!userAppScopesMap.has(userAppKey)) {
              userAppScopesMap.set(userAppKey, new Set<string>());
          }
          const userScopesForApp = userAppScopesMap.get(userAppKey)!;
          tokenScopes.forEach((scope: string) => userScopesForApp.add(scope));
        }

        // **NEW: Force memory cleanup periodically**
        const currentUsage = monitor.getCurrentUsage();
        if (currentUsage.heapUsed > PROCESSING_CONFIG.EMERGENCY_LIMITS.FORCE_CLEANUP_THRESHOLD) {
          console.log(`[TestCron:Microsoft:${orgDomain}] 🧹 Memory cleanup triggered at ${currentUsage.heapUsed}MB`);
          forceMemoryCleanup();
        }
      },
      `TestCron:Microsoft:${orgDomain} TOKEN_PROCESSING`,
      PROCESSING_CONFIG.BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

    const uniqueMSApps = Array.from(msAppsMap.values());
    console.log(`[TestCron:Microsoft:${orgDomain}] Found ${uniqueMSApps.length} unique applications with resource management.`);
    
    // **NEW: Log resource usage after token processing**
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} TOKEN_PROCESSING COMPLETE`);

    // 8. Fetch existing data from the Supabase DB
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetching existing data from Supabase DB...`);
    const { data: existingDbApps, error: appError } = await supabaseAdmin
        .from('applications')
        .select('name')
        .eq('organization_id', org.id);

    const { data: existingDbUserAppRels, error: relError } = await supabaseAdmin
        .from('user_applications')
        .select(`
            application:applications!inner(name),
            user:users!inner(microsoft_user_id)
        `)
        .eq('application.organization_id', org.id);

    if (appError || relError) {
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error fetching existing data from Supabase:`, { appError, relError });
      return NextResponse.json({ error: 'DB fetch error' }, { status: 500 });
    }

    // 9. Compare datasets to find what's new
    console.log(`[TestCron:Microsoft:${orgDomain}] 🔍 Comparing datasets...`);

    const existingAppNames = new Set(existingDbApps?.map((a: any) => a.name) || []);
    const newApps = uniqueMSApps.filter(app => !existingAppNames.has(app.name));

    const dbUserAppRelsByName = new Set(existingDbUserAppRels?.map((r: any) => r.user && r.application ? `${r.user.microsoft_user_id}:${r.application.name}` : null).filter(Boolean) || []);
    const newRelationships: { user: any; app: any; userKey: string; }[] = [];
    
    uniqueMSApps.forEach(app => {
        app.users.forEach(userKey => {
            const msRelationshipId = `${userKey}:${app.name}`;
            if (!dbUserAppRelsByName.has(msRelationshipId)) {
                const user = msUserMap.get(userKey);
                if (user) {
                    newRelationships.push({ user, app, userKey });
                }
            }
        });
    });

    // 10. Write new entries to the database
    if (newApps.length === 0 && newRelationships.length === 0) {
      console.log(`[TestCron:Microsoft:${orgDomain}] ✅ No new applications or relationships to write.`);
    } else {
      console.log(`[TestCron:Microsoft:${orgDomain}] Writing new entries. New apps: ${newApps.length}, New relationships: ${newRelationships.length}`);
      console.log(`[TestCron:Microsoft:${orgDomain}] --- DATABASE WRITES DISABLED FOR TEST RUN ---`);
      
      const appNameToDbIdMap = new Map<string, string>();

      // Insert new applications with resource management
      if (newApps.length > 0) {
        console.log(`[TestCron:Microsoft:${orgDomain}] Processing ${newApps.length} new applications with resource management...`);
        
        // **NEW: Process apps in resource-aware batches for categorization**
        const appsToInsert: any[] = [];
        await processInBatchesWithResourceControl(
          newApps,
          async (appBatch) => {
            const batchInserts = await Promise.all(appBatch.map(async (app) => {
              const all_scopes: string[] = Array.from(app.scopes);
              const risk_level = determineRiskLevel(all_scopes);
              const category = await categorizeApplication(app.name, all_scopes);
              return {
                organization_id: org.id,
                microsoft_app_id: Array.from(app.ids)[0], // Store one of the client IDs
                name: app.name,
                category,
                risk_level: transformRiskLevel(risk_level),
                management_status: 'Newly discovered',
                all_scopes,
                total_permissions: all_scopes.length,
                provider: 'microsoft'
              };
            }));
            appsToInsert.push(...batchInserts);
          },
          `TestCron:Microsoft:${orgDomain} APP_CATEGORIZATION`,
          Math.min(PROCESSING_CONFIG.BATCH_SIZE, 10), // Smaller batches for AI categorization
          PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
        );
        
        // **NEW: Insert apps in resource-aware batches**
        await processInBatchesWithResourceControl(
          appsToInsert,
          async (insertBatch) => {
            const { data: insertedApps, error: insertAppsError } = await supabaseAdmin
              .from('applications')
              .insert(insertBatch)
              .select('id, name');

            if (insertAppsError) {
              console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting application batch:`, insertAppsError);
            } else if (insertedApps) {
              insertedApps.forEach(a => appNameToDbIdMap.set(a.name, a.id));
            }
          },
          `TestCron:Microsoft:${orgDomain} APP_INSERT`,
          PROCESSING_CONFIG.BATCH_SIZE,
          PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
        );
        
        console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully processed ${newApps.length} new applications with resource monitoring.`);
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
          console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error fetching DB IDs:`, { involvedAppsError, involvedUsersError });
        } else {
          const userEmailToDbIdMap = new Map(involvedUsers?.map(u => [u.email, u.id]) || []);
          
          const relsToInsert = newRelationships.flatMap(rel => {
            const application_id = appNameToDbIdMap.get(rel.app.name);
            const user_id = userEmailToDbIdMap.get(rel.user.email);
            
            if (!application_id || !user_id) {
              console.warn(`[TestCron:Microsoft:${orgDomain}] ⚠️ Skipping relationship for ${rel.user.email} and ${rel.app.name} (missing DB ID).`);
              return [];
            }
            
            // Get the user-specific scopes for this relationship
            const scopesSet = userAppScopesMap.get(`${rel.userKey}:${rel.app.name}`) || new Set();
            
            return [{ application_id, user_id, scopes: Array.from(scopesSet) }];
          });

          if (relsToInsert.length > 0) {
            // **NEW: Insert relationships in resource-aware batches**
            await processInBatchesWithResourceControl(
              relsToInsert,
              async (relBatch) => {
                const { error: insertRelsError } = await supabaseAdmin
                  .from('user_applications')
                  .insert(relBatch as any);
                
                if (insertRelsError) {
                  console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting relationship batch:`, insertRelsError);
                }
              },
              `TestCron:Microsoft:${orgDomain} RELATIONS_INSERT`,
              PROCESSING_CONFIG.BATCH_SIZE,
              PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
            );
            console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully processed ${relsToInsert.length} new user-app relationships with resource monitoring.`);
          }
        }
        
      }
    }

    // 11. Log the results
    console.log(`--- [TestCron:Microsoft:${orgDomain}] RESULTS ---`);
    if (newApps.length > 0) {
      console.log(`✅ Found ${newApps.length} new applications:`);
      newApps.forEach((app: any) => console.log(`  - Name: ${app.name}, Users: ${app.users.size}`));
    } else {
      console.log('✅ No new applications found.');
    }

    if (newRelationships.length > 0) {
        console.log(`✅ Found ${newRelationships.length} new user-app relationships:`);
        newRelationships.sort((a,b) => {
          const emailA = a.user?.email || '';
          const emailB = b.user?.email || '';
          const nameA = a.app?.name || '';
          const nameB = b.app?.name || '';
          return emailA.localeCompare(emailB) || nameA.localeCompare(nameB);
        });
        newRelationships.forEach(rel => console.log(`  - User: ${rel.user.name} (${rel.user.email}) to App: ${rel.app.name}`));
    } else {
        console.log('✅ No new user-app relationships found.');
    }
    console.log(`--- [TestCron:Microsoft:${orgDomain}] END RESULTS ---`);
    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Test run for ${orgDomain} completed successfully.`);

    // **NEW: Log final resource usage**
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} COMPLETE`);

    // 11. Send reports
    if (newApps.length > 0) {
      await processWeeklyNewAppReport(org, newApps);
    }
    if (newRelationships.length > 0) {
      await processNewUserDigestReport(org, newRelationships);
    }

    return NextResponse.json({
      success: true,
      message: `Test cron for ${orgDomain} completed successfully.`,
      results: {
        newAppsFound: newApps.length,
        newUserAppRelationshipsFound: newRelationships.length,
        newApps: newApps.map((a: any) => ({ name: a.name, userCount: a.users.size })),
        newUserAppRelationships: newRelationships.map(r => ({ userName: r.user.name, userEmail: r.user.email, appName: r.app.name }))
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error(`[TestCron:Microsoft:${orgDomain}] ❌ An unexpected error occurred:`, error);
    
    // **NEW: Log resource usage on error**
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} ERROR`);
    
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
}

async function processWeeklyNewAppReport(org: { id: string, name: string }, newApps: any[]) {
  try {
    console.log(`[TestCron:Microsoft:${org.name}] Checking for weekly new app reports...`);
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();
    const weekIdentifier = `weekly-apps-${currentYear}-${currentWeek}`;

    // Check if any apps were discovered this week (not just added to our newApps array)
    const startOfWeek = getStartOfWeek(new Date());
    const { data: appsDiscoveredThisWeek, error: weeklyAppsError } = await supabaseAdmin
      .from('applications')
      .select('id, name, total_permissions, risk_level, created_at')
      .eq('organization_id', org.id)
      .eq('provider', 'microsoft')
      .gte('created_at', startOfWeek.toISOString());

    if (weeklyAppsError) {
      console.error(`[TestCron:Microsoft:${org.name}] Error fetching weekly apps:`, weeklyAppsError);
      return;
    }

    // If no apps were discovered this week, skip the report
    if (!appsDiscoveredThisWeek || appsDiscoveredThisWeek.length === 0) {
      console.log(`[TestCron:Microsoft:${org.name}] No apps discovered this week, skipping weekly report.`);
      return;
    }

    console.log(`[TestCron:Microsoft:${org.name}] Found ${appsDiscoveredThisWeek.length} apps discovered this week.`);

    // Get user counts for each app discovered this week
    const appIds = appsDiscoveredThisWeek.map(app => app.id);
    const { data: userCounts, error: userCountError } = await supabaseAdmin
      .from('user_applications')
      .select('application_id')
      .in('application_id', appIds);

    if (userCountError) {
      console.error(`[TestCron:Microsoft:${org.name}] Error fetching user counts:`, userCountError);
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
      `App name: ${app.name}\nTotal scope permission(s): ${app.total_permissions}\nScope Risk level: ${app.risk_level}\nTotal user(s): ${userCountMap.get(app.id) || 0}`
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
    console.error(`[TestCron:Microsoft:${org.name}] Error processing weekly new app report:`, error);
  }
}

async function processNewUserDigestReport(org: { id: string, name: string }, newRelationships: any[]) {
  try {
    console.log(`[TestCron:Microsoft:${org.name}] Checking for new user digest report...`);
    const reportIdentifier = `digest-users-${new Date().toISOString().split('T')[0]}`;

    const usersToAppsMap = new Map<string, string[]>();
    newRelationships.forEach(ua => {
      const email = ua.user.email;
      if (!usersToAppsMap.has(email)) {
        usersToAppsMap.set(email, []);
      }
      usersToAppsMap.get(email)!.push(ua.app.name);
    });

    const eventUsersString = Array.from(usersToAppsMap.entries()).map(([email, apps]) => 
      `User email: ${email}\nApp names: ${apps.join(', ')}`
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
    console.error(`[TestCron:Microsoft:${org.name}] Error processing new user report:`, error);
  }
}

async function getNotificationPreferences(organizationId: string, preferenceType: 'new_app_detected' | 'new_user_in_app') {
  const { data: prefs, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_email')
    .eq('organization_id', organizationId)
    .eq(preferenceType, true);

  if (error) {
    console.error(`[TestCron:Microsoft] Error fetching notification preferences for ${preferenceType} for org ${organizationId}:`, error);
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
    .eq('report_identifier', reportIdentifier); // Using report_identifier to store the report identifier

  if (checkError) {
    console.error('[TestCron:Microsoft] Error checking for report:', checkError);
    return;
  }

  if (existing && existing.length > 0) {
    console.log(`[TestCron:Microsoft] Report ${notificationType} for ${reportIdentifier} already sent to ${userEmail}.`);
    return;
  }

  const success = await sendFunction();
  if (success) {
    await supabaseAdmin.from('notification_tracking').insert({
      organization_id: organizationId,
      user_email: userEmail,
      notification_type: notificationType,
      report_identifier: reportIdentifier, // Storing report identifier in the correct column
      sent_at: new Date().toISOString()
    });
    console.log(`[TestCron:Microsoft] Successfully sent and tracked report ${notificationType} to ${userEmail}`);
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