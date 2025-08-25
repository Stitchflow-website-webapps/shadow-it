import { NextResponse, NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { determineRiskLevel, transformRiskLevel } from '@/lib/risk-assessment';
import { categorizeApplication } from '@/app/api/background/sync/categorize/route';
import { EmailService } from '@/app/lib/services/email-service';
import { ResourceMonitor, processInBatchesWithResourceControl } from '@/lib/resource-monitor';

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
  // **FIXED: Support both query parameter and request body for orgDomain**
  const { searchParams } = new URL(request.url);
  let orgDomain = searchParams.get('orgDomain');
  
  // If not in query params, try to get from request body
  if (!orgDomain) {
    try {
      const body = await request.json();
      orgDomain = body.orgDomain;
    } catch (error) {
      // Ignore JSON parsing errors, orgDomain might be in query params
    }
  }

  if (!orgDomain) {
    return NextResponse.json({ 
      error: 'orgDomain is required',
      usage: 'Provide orgDomain as query parameter (?orgDomain=domain.com) or in request body {"orgDomain":"domain.com"}'
    }, { status: 400 });
  }

  // 1. Authenticate the request using a secret bearer token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];

  if (token !== process.env.CRON_SECRET) {
    console.error(`[TestCron:${orgDomain}] Unauthorized request`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`🚀 [TestCron:${orgDomain}] Starting test cron job for ${orgDomain}...`);
  
  // **NEW: Initialize resource monitoring**
  const monitor = ResourceMonitor.getInstance();
  monitor.logResourceUsage(`TestCron:${orgDomain} START`);

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
    
    // Check environment variables for user filtering preferences (consistent with main sync)
    const includeSuspended = process.env.GOOGLE_INCLUDE_SUSPENDED === 'true';
    const includeArchived = process.env.GOOGLE_INCLUDE_ARCHIVED === 'true';
    
    const [allGoogleUsers, allGoogleTokens] = await Promise.all([
      googleService.getUsersListPaginated(includeSuspended, includeArchived),
      googleService.getOAuthTokens()
    ]);
    
    // Update progress with dynamic message based on filtering
    const filterMsg = includeSuspended ? 'including suspended' : 'excluding suspended';
    const archivedMsg = includeArchived ? 'including archived' : 'excluding archived';
    console.log(`[TestCron:${orgDomain}] Fetched ${allGoogleUsers.length} users (${filterMsg}, ${archivedMsg}) and ${allGoogleTokens.length} total app tokens from Google.`);
    
    // **REMOVED: Emergency limits - processing all organizations regardless of size**
    console.log(`[TestCron:${orgDomain}] Processing large organization with ${allGoogleUsers.length} users and ${allGoogleTokens.length} tokens...`);
    
    // **NEW: Log resource usage after fetch**
    monitor.logResourceUsage(`TestCron:${orgDomain} FETCH COMPLETE`);

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

      // **NEW: Use resource-aware batch processing for user insertion**
      try {
        await processInBatchesWithResourceControl(
          usersToInsert,
          async (userBatch) => {
            const { error: insertUsersError } = await supabaseAdmin
              .from('users')
              .insert(userBatch);

            if (insertUsersError) {
              console.error(`[TestCron:${orgDomain}] ❌ Error inserting user batch:`, insertUsersError);
            }
          },
          `TestCron:${orgDomain} USER_INSERT`,
          PROCESSING_CONFIG.BATCH_SIZE,
          PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
        );
        console.log(`[TestCron:${orgDomain}] ✅ Successfully processed ${newGoogleUsers.length} new users with resource monitoring.`);
      } catch (insertError) {
        console.error(`[TestCron:${orgDomain}] ❌ Error in resource-aware user insertion:`, insertError);
        // We log the error but continue, as some relationships might still be processable
      }
    } else {
      console.log(`[TestCron:${orgDomain}] ✅ Users table is already up to date.`);
    }

    // Create a lookup map for user email/name by Google ID for easier logging
    const googleUserMap = new Map(allGoogleUsers.map((u: any) => [u.id, { email: u.primaryEmail, name: u.name.fullName }]));

    // 7. Process and de-duplicate applications from the raw token list with resource management
    console.log(`[TestCron:${orgDomain}] De-duplicating application list with memory management...`);
    const googleAppsMap = new Map<string, { id: string; name: string; users: Set<string>; scopes: Set<string>; }>();
    const userAppScopesMap = new Map<string, Set<string>>();

    // **NEW: Process tokens in resource-aware batches**
    await processInBatchesWithResourceControl(
      allGoogleTokens,
      async (tokenBatch) => {
        tokenBatch.forEach((token: any) => {
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

        // **NEW: Force memory cleanup periodically**
        const currentUsage = monitor.getCurrentUsage();
        if (currentUsage.heapUsed > PROCESSING_CONFIG.EMERGENCY_LIMITS.FORCE_CLEANUP_THRESHOLD) {
          console.log(`[TestCron:${orgDomain}] 🧹 Memory cleanup triggered at ${currentUsage.heapUsed}MB`);
          forceMemoryCleanup();
        }
      },
      `TestCron:${orgDomain} TOKEN_PROCESSING`,
      PROCESSING_CONFIG.BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

    const uniqueGoogleApps = Array.from(googleAppsMap.values());
    console.log(`[TestCron:${orgDomain}] Found ${uniqueGoogleApps.length} unique applications with resource management.`);
    
    // **NEW: Log resource usage after token processing**
    monitor.logResourceUsage(`TestCron:${orgDomain} TOKEN_PROCESSING COMPLETE`);


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

      // Insert new applications with resource management
      if (newApps.length > 0) {
        console.log(`[TestCron:${orgDomain}] Processing ${newApps.length} new applications with resource management...`);
        
        // **NEW: Process apps in resource-aware batches for categorization**
        const appsToInsert: any[] = [];
        await processInBatchesWithResourceControl(
          newApps,
          async (appBatch) => {
            const batchInserts = await Promise.all(appBatch.map(async (app) => {
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
            appsToInsert.push(...batchInserts);
          },
          `TestCron:${orgDomain} APP_CATEGORIZATION`,
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
              console.error(`[TestCron:${orgDomain}] ❌ Error inserting application batch:`, insertAppsError);
            } else if (insertedApps) {
              insertedApps.forEach(a => appNameToDbIdMap.set(a.name, a.id));
            }
          },
          `TestCron:${orgDomain} APP_INSERT`,
          PROCESSING_CONFIG.BATCH_SIZE,
          PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
        );
        
        console.log(`[TestCron:${orgDomain}] ✅ Successfully processed ${newApps.length} new applications with resource monitoring.`);
      }

      // Insert new user-application relationships
      if (newRelationships.length > 0) {
        console.log(`[TestCron:${orgDomain}] Processing ${newRelationships.length} new relationships with batched ID fetching...`);
        
        // **FIXED: Batch the ID fetching to avoid 414 Request-URI Too Large errors**
        const allInvolvedAppNames = Array.from(new Set(newRelationships.map(r => r.app.name)));
        const allInvolvedUserEmails = Array.from(new Set(newRelationships.map(r => r.user.email)));
        
        console.log(`[TestCron:${orgDomain}] Fetching IDs for ${allInvolvedAppNames.length} apps and ${allInvolvedUserEmails.length} users...`);
        
        // **EXTREME SPEED: Parallel batch fetching for maximum performance**
        const appBatchSize = 50; // Smaller batches for parallel processing
        const userBatchSize = 50; // Smaller batches for parallel processing
        
        // Create all app and user batch promises in parallel
        const appBatchPromises = [];
        for (let i = 0; i < allInvolvedAppNames.length; i += appBatchSize) {
          const appNameBatch = allInvolvedAppNames.slice(i, i + appBatchSize);
          appBatchPromises.push(
            supabaseAdmin
              .from('applications')
              .select('id, name')
              .in('name', appNameBatch)
              .eq('organization_id', org.id)
          );
        }
        
        const userBatchPromises = [];
        for (let i = 0; i < allInvolvedUserEmails.length; i += userBatchSize) {
          const userEmailBatch = allInvolvedUserEmails.slice(i, i + userBatchSize);
          userBatchPromises.push(
            supabaseAdmin
              .from('users')
              .select('id, email')
              .in('email', userEmailBatch)
              .eq('organization_id', org.id)
          );
        }
        
        // Execute all app and user fetches in parallel
        console.log(`[TestCron:${orgDomain}] Fetching ${appBatchPromises.length} app batches and ${userBatchPromises.length} user batches in parallel...`);
        
        const [appResults, userResults] = await Promise.all([
          Promise.all(appBatchPromises),
          Promise.all(userBatchPromises)
        ]);
        
        // Process app results
        appResults.forEach((result, index) => {
          if (result.error) {
            console.error(`[TestCron:${orgDomain}] ❌ Error fetching app batch ${index + 1}:`, result.error);
          } else if (result.data) {
            result.data.forEach(a => appNameToDbIdMap.set(a.name, a.id));
          }
        });
        
        // Process user results
        const userEmailToDbIdMap = new Map();
        userResults.forEach((result, index) => {
          if (result.error) {
            console.error(`[TestCron:${orgDomain}] ❌ Error fetching user batch ${index + 1}:`, result.error);
          } else if (result.data) {
            result.data.forEach(u => userEmailToDbIdMap.set(u.email, u.id));
          }
        });
        
        console.log(`[TestCron:${orgDomain}] Successfully fetched ${appNameToDbIdMap.size} app IDs and ${userEmailToDbIdMap.size} user IDs`);
        
        // Create relationships with the fetched IDs
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
          console.log(`[TestCron:${orgDomain}] Inserting ${relsToInsert.length} relationships...`);
          
          // **NEW: Insert relationships in resource-aware batches**
          await processInBatchesWithResourceControl(
            relsToInsert,
            async (relBatch) => {
              const { error: insertRelsError } = await supabaseAdmin
                .from('user_applications')
                .insert(relBatch as any);
              
              if (insertRelsError) {
                console.error(`[TestCron:${orgDomain}] ❌ Error inserting relationship batch:`, insertRelsError);
              }
            },
            `TestCron:${orgDomain} RELATIONS_INSERT`,
            PROCESSING_CONFIG.BATCH_SIZE,
            PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
          );
          console.log(`[TestCron:${orgDomain}] ✅ Successfully processed ${relsToInsert.length} new user-app relationships with resource monitoring.`);
        } else {
          console.log(`[TestCron:${orgDomain}] ⚠️ No valid relationships to insert (all missing required IDs).`);
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

    // **NEW: Log final resource usage**
    monitor.logResourceUsage(`TestCron:${orgDomain} COMPLETE`);

    // 12. Send reports
    if (newApps.length > 0) {
      await processWeeklyNewAppReport(org, newApps);
    }
    if (newRelationships.length > 0) {
      await processNewUserDigestReport(org, newRelationships, googleUserMap);
    }

    // **NEW: Send webhook notification for newly discovered apps**
    if (newApps.length > 0) {
      const newAppNames = newApps.map(app => app.name);
      await sendNewAppsWebhookNotification(org.id, newAppNames, orgDomain);
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
    
    // **NEW: Log resource usage on error**
    monitor.logResourceUsage(`TestCron:${orgDomain} ERROR`);
    
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
    .eq('report_identifier', reportIdentifier); // Using report_identifier to store the report identifier

  if (checkError) {
    console.error('[TestCron:Google] Error checking for report:', checkError);
    return;
  }

  if (existing && existing.length > 0) {
    console.log(`[TestCron:Google] Report ${notificationType} for ${reportIdentifier} already sent to ${userEmail}.`);
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

// **EXTREME SPEED MODE: Maximum performance configuration**
const PROCESSING_CONFIG = {
  BATCH_SIZE: 200, // Large batch size for maximum speed
  DELAY_BETWEEN_BATCHES: 25, // Minimal delays for speed
  EMERGENCY_LIMITS: {
    MAX_USERS_IN_MEMORY: 50000, // Higher memory limits for speed
    MAX_TOKENS_IN_MEMORY: 20000, // Higher token limits for speed
    FORCE_CLEANUP_THRESHOLD: 1500, // Higher threshold before cleanup
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
      console.log(`[TestCron:Google] Memory usage high: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, forcing cleanup`);
      if (global.gc) global.gc();
    }
  }
};

// **NEW: Add GET endpoint for relationships-only processing**
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const orgDomain = url.searchParams.get('org');
  const mode = url.searchParams.get('mode');
  
  // **NEW: Support relationships-only mode**
  if (mode === 'relationships-only') {
    return await processRelationshipsOnly(orgDomain);
  }
  
  // Default behavior for existing functionality
  return NextResponse.json({ 
    error: 'Missing parameters',
    usage: 'Use ?org=domain.com&mode=relationships-only to process only relationships'
  }, { status: 400 });
}

// **NEW: Relationships-only processing function**
async function processRelationshipsOnly(orgDomain: string | null) {
  if (!orgDomain) {
    return NextResponse.json({ error: 'Organization domain is required' }, { status: 400 });
  }

  console.log(`[RelationshipsOnly:${orgDomain}] 🔄 Starting intelligent relationships reconstruction...`);
  
  const monitor = new ResourceMonitor();
  monitor.logResourceUsage(`RelationshipsOnly:${orgDomain} START`);

  try {
    // 1. Get organization details
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain')
      .eq('domain', orgDomain)
      .single();

    if (orgError || !org) {
      console.error(`[RelationshipsOnly:${orgDomain}] ❌ Organization not found:`, orgError);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    console.log(`[RelationshipsOnly:${orgDomain}] ✅ Found organization: ${org.name} (ID: ${org.id})`);

    // 2. Get existing data and analyze what we can reconstruct
    console.log(`[RelationshipsOnly:${orgDomain}] 🔍 Analyzing existing data for relationship reconstruction...`);
    
    const [usersResult, appsResult, existingRelationshipsResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, email, google_user_id, name')
        .eq('organization_id', org.id),
      supabaseAdmin
        .from('applications')
        .select('id, name, google_app_id, user_count, all_scopes, owner_email')
        .eq('organization_id', org.id)
        .eq('provider', 'google'),
      supabaseAdmin
        .from('user_applications')
        .select('user_id, application_id')
        .eq('organization_id', org.id)
    ]);

    if (usersResult.error || appsResult.error) {
      console.error(`[RelationshipsOnly:${orgDomain}] ❌ Error fetching data:`, { usersResult: usersResult.error, appsResult: appsResult.error });
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }

    const existingUsers = usersResult.data || [];
    const existingApps = appsResult.data || [];
    const existingRelationships = existingRelationshipsResult.data || [];

    console.log(`[RelationshipsOnly:${orgDomain}] 📊 Data summary:`);
    console.log(`  - Users: ${existingUsers.length}`);
    console.log(`  - Applications: ${existingApps.length}`);
    console.log(`  - Existing relationships: ${existingRelationships.length}`);

    if (existingUsers.length === 0) {
      return NextResponse.json({ error: 'No users found - run full sync first' }, { status: 400 });
    }

    if (existingApps.length === 0) {
      return NextResponse.json({ error: 'No applications found - run full sync first' }, { status: 400 });
    }

    // 3. **INTELLIGENT APPROACH**: Analyze applications for relationship clues
    console.log(`[RelationshipsOnly:${orgDomain}] 🧠 Analyzing applications for relationship patterns...`);
    
    // Create lookup maps
    const userEmailToId = new Map(existingUsers.map(u => [u.email.toLowerCase(), u.id]));
    const existingRelationshipsSet = new Set(
      existingRelationships.map(rel => `${rel.user_id}:${rel.application_id}`)
    );

    const relationshipsToCreate = [];
    let analysisResults = {
      appsWithOwners: 0,
      appsWithUserCounts: 0,
      ownerRelationshipsCreated: 0,
      estimatedTotalRelationships: 0,
      totalPossibleRelationships: existingUsers.length * existingApps.length
    };

    // Analyze each application for relationship clues
    for (const app of existingApps) {
      console.log(`[RelationshipsOnly:${orgDomain}] 🔍 Analyzing app: ${app.name}`);
      
      // Strategy 1: Owner relationships (most accurate)
      if (app.owner_email) {
        analysisResults.appsWithOwners++;
        const ownerUserId = userEmailToId.get(app.owner_email.toLowerCase());
        
        if (ownerUserId) {
          const relationshipKey = `${ownerUserId}:${app.id}`;
          if (!existingRelationshipsSet.has(relationshipKey)) {
            relationshipsToCreate.push({
              user_id: ownerUserId,
              application_id: app.id,
              organization_id: org.id,
              scopes: app.all_scopes || [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
            analysisResults.ownerRelationshipsCreated++;
          }
        }
      }

      // Strategy 2: User count analysis (for estimation)
      if (app.user_count && app.user_count > 0) {
        analysisResults.appsWithUserCounts++;
        analysisResults.estimatedTotalRelationships += app.user_count;
      }
    }

    console.log(`[RelationshipsOnly:${orgDomain}] 📈 Analysis Results:`);
    console.log(`  - Apps with owners: ${analysisResults.appsWithOwners}`);
    console.log(`  - Apps with user counts: ${analysisResults.appsWithUserCounts}`);
    console.log(`  - Owner relationships to create: ${analysisResults.ownerRelationshipsCreated}`);
    console.log(`  - Estimated total relationships in org: ${analysisResults.estimatedTotalRelationships}`);
    console.log(`  - Total possible relationships: ${analysisResults.totalPossibleRelationships}`);

    // 4. Provide user with options based on analysis
    if (relationshipsToCreate.length === 0) {
      console.log(`[RelationshipsOnly:${orgDomain}] ⚠️ No owner-based relationships found. The original OAuth token data would be needed for accurate relationships.`);
      
      return NextResponse.json({
        success: false,
        message: `No accurate relationships can be reconstructed from existing data`,
        analysis: {
          ...analysisResults,
          recommendation: "The original OAuth tokens contained the exact user-app relationships, but they're not accessible due to scope limitations. Consider re-running with proper admin scopes, or manual relationship creation based on your organization's knowledge."
        },
        options: {
          option1: "Re-authenticate with admin scopes to fetch fresh OAuth data",
          option2: "Manually specify known user-app relationships",
          option3: "Use application owner data only (limited accuracy)"
        }
      });
    }

    // 5. Insert the accurate owner-based relationships
    console.log(`[RelationshipsOnly:${orgDomain}] 🔄 Creating ${relationshipsToCreate.length} owner-based relationships...`);
    
    await processInBatchesWithResourceControl(
      relationshipsToCreate,
      async (relationshipBatch) => {
        const { error: insertError } = await supabaseAdmin
          .from('user_applications')
          .insert(relationshipBatch);
        
        if (insertError) {
          console.error(`[RelationshipsOnly:${orgDomain}] ❌ Error inserting relationship batch:`, insertError);
        } else {
          console.log(`[RelationshipsOnly:${orgDomain}] ✅ Successfully inserted batch of ${relationshipBatch.length} relationships`);
        }
      },
      `RelationshipsOnly:${orgDomain}`,
      100,
      500
    );

    monitor.logResourceUsage(`RelationshipsOnly:${orgDomain} COMPLETE`);

    return NextResponse.json({
      success: true,
      message: `Intelligent relationships reconstruction completed for ${orgDomain}`,
      results: {
        approach: 'owner-based reconstruction (partial but accurate)',
        existingUsers: existingUsers.length,
        existingApplications: existingApps.length,
        existingRelationships: existingRelationships.length,
        newRelationshipsCreated: relationshipsToCreate.length,
        totalRelationshipsAfter: existingRelationships.length + relationshipsToCreate.length,
        analysis: analysisResults,
        dataQuality: 'High accuracy for owner relationships, but incomplete coverage',
        nextSteps: relationshipsToCreate.length < analysisResults.estimatedTotalRelationships 
          ? 'Consider re-authentication with admin scopes for complete data'
          : 'Relationship data appears complete'
      }
    });

  } catch (error) {
    console.error(`[RelationshipsOnly:${orgDomain}] ❌ Error:`, error);
    monitor.logResourceUsage(`RelationshipsOnly:${orgDomain} ERROR`);
    
    return NextResponse.json({
      error: 'Failed to process relationships',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
// **NEW: Helper function to clean app names for webhook**
function cleanAppNameForWebhook(appName: string): string {
  // Remove all commas and "Inc" or "Inc." suffixes (case insensitive)
  let cleanedName = appName.replace(/,/g, '');
  cleanedName = cleanedName.replace(/\s*Inc\.?$/i, '');
  
  return cleanedName.trim();
}

// **NEW: Helper function to send webhook notification for newly discovered apps**
async function sendNewAppsWebhookNotification(organizationId: string, newAppNames: string[], orgDomain: string) {
  if (!newAppNames || newAppNames.length === 0) {
    console.log(`[TestCron:${orgDomain}] No new apps to send via webhook`);
    return;
  }

  const webhookUrl = process.env.WEBHOOK_URL || 'https://primary-production-d8d8.up.railway.app/webhook/66c5e72a-c46f-4aeb-8c3a-4e4bc7c9caf4';
  const webhookUsername = process.env.WEBHOOK_USERNAME || 'SF-AI-DB';
  const webhookPassword = process.env.WEBHOOK_PASSWORD || 'SF-AI-DB';

  try {
    // Clean app names and create comma-separated string
    const cleanedAppNames = newAppNames
      .map(appName => cleanAppNameForWebhook(appName))
      .filter(name => name && name.trim()) // Remove empty names
      .join(', ');

    // Prepare webhook payload in the correct format
    const webhookPayload = {
      org_id: organizationId,
      tool_name: cleanedAppNames
    };

    // Create basic auth header
    const basicAuth = Buffer.from(`${webhookUsername}:${webhookPassword}`).toString('base64');

    console.log(`[TestCron:${orgDomain}] Sending webhook notification for ${newAppNames.length} newly discovered apps`);

    // Send webhook request
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: JSON.stringify(webhookPayload),
    });

    if (response.ok) {
      const responseData = await response.text();
      console.log(`[TestCron:${orgDomain}] Webhook notification sent successfully:`, responseData);
    } else {
      const errorData = await response.text();
      console.error(`[TestCron:${orgDomain}] Failed to send webhook notification. Status: ${response.status}, Response: ${errorData}`);
    }
  } catch (error) {
    console.error(`[TestCron:${orgDomain}] Error sending webhook notification:`, error);
  }
} 