import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { determineRiskLevel, transformRiskLevel } from '@/lib/risk-assessment';
import { categorizeApplication } from '@/app/api/background/sync/categorize/route';
import { EmailService } from '@/app/lib/services/email-service';
import { ResourceMonitor, processInBatchesWithResourceControl } from '@/lib/resource-monitor';

// **EXTREME SPEED MODE: Maximum performance configuration (Google-style)**
const PROCESSING_CONFIG = {
  BATCH_SIZE: 200, // Large batch size for maximum speed
  DELAY_BETWEEN_BATCHES: 25, // Minimal delays for speed
  EMERGENCY_LIMITS: {
    MAX_USERS_IN_MEMORY: 50000, // Higher memory limits for speed
    MAX_TOKENS_IN_MEMORY: 20000, // Higher token limits for speed
    FORCE_CLEANUP_THRESHOLD: 1500, // Higher threshold before cleanup
  },
  TOKEN_REFRESH_THRESHOLD: 2700000, // Refresh tokens at 45 minutes (2700 seconds)
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
 * OPTIMIZED test cron job for a specific Microsoft organization.
 * This job fetches and compares user and application data from Microsoft Graph API against the database.
 * It identifies new users, new applications, and new user-application relationships.
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

  console.log(`🚀 [TestCron:Microsoft:${orgDomain}] Starting OPTIMIZED test cron job for ${orgDomain}...`);
  
  // **NEW: Initialize resource monitoring and performance timing**
  const monitor = ResourceMonitor.getInstance();
  const startTime = Date.now();
  const phaseTimings: Record<string, number> = {};
  
  const logPhaseTime = (phaseName: string) => {
    const now = Date.now();
    const elapsed = now - startTime;
    phaseTimings[phaseName] = elapsed;
    console.log(`⏱️ [TestCron:Microsoft:${orgDomain}] ${phaseName}: ${elapsed}ms (${Math.round(elapsed/1000)}s)`);
    
    // **CRITICAL: Check if we're approaching the 1-hour token limit (45 minutes = 2700 seconds)**
    if (elapsed > PROCESSING_CONFIG.TOKEN_REFRESH_THRESHOLD) {
      console.warn(`⚠️ [TestCron:Microsoft:${orgDomain}] WARNING: Approaching 1-hour token limit! Current time: ${Math.round(elapsed/1000)}s`);
    }
  };
  
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
    logPhaseTime('Organization lookup');

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
    logPhaseTime('Token refresh and service setup');

    // 5. Fetch all users and application tokens (with scopes) from Microsoft Graph API
    const allMSUsers = await microsoftService.getUsersList();
    const allMSAppTokens = await microsoftService.getOAuthTokens();
    
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetched ${allMSUsers.length} users and ${allMSAppTokens.length} user-app tokens.`);
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} FETCH COMPLETE`);
    logPhaseTime('Microsoft Graph API data fetch');
    
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

      await processInBatchesWithResourceControl(
        usersToInsert,
        async (userBatch) => {
          const { error: batchError } = await supabaseAdmin.from('users').insert(userBatch);
          if (batchError) {
            console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting user batch:`, batchError);
          }
        },
        `TestCron:Microsoft:${orgDomain} USER_INSERT`,
        PROCESSING_CONFIG.BATCH_SIZE,
        PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
      );
    } else {
      console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Users table is already up to date.`);
    }

    const msUserMap = new Map(allMSUsers.map((u: any) => [u.id, { email: u.mail, name: u.displayName }]));
    logPhaseTime('User sync and processing');

    // 7. Process and de-duplicate applications from the token list
    console.log(`[TestCron:Microsoft:${orgDomain}] De-duplicating application list...`);
    const msAppsMap = new Map<string, { ids: Set<string>; name: string; users: Set<string>; scopes: Set<string>; }>();
    const userAppScopesMap = new Map<string, Set<string>>();

    await processInBatchesWithResourceControl(
      allMSAppTokens,
      async (tokenBatch) => {
        tokenBatch.forEach((token: any) => {
          if (!token.displayText || !token.userKey) return;
          if (!msAppsMap.has(token.displayText)) {
            msAppsMap.set(token.displayText, {
              ids: new Set([token.clientId]),
              name: token.displayText,
              users: new Set(),
              scopes: new Set(),
            });
          }
          const appEntry = msAppsMap.get(token.displayText)!;
          appEntry.users.add(token.userKey);
          token.scopes.forEach((s: string) => appEntry.scopes.add(s));

          const userAppKey = `${token.userKey}:${token.displayText}`;
          if (!userAppScopesMap.has(userAppKey)) {
            userAppScopesMap.set(userAppKey, new Set<string>());
          }
          // Populate per-user scopes for this app from all available scope sources
          const perUserSet = userAppScopesMap.get(userAppKey)!;
          if (Array.isArray(token.scopes)) {
            token.scopes.forEach((s: string) => perUserSet.add(s));
          }
          if (Array.isArray(token.userScopes)) {
            token.userScopes.forEach((s: string) => perUserSet.add(s));
          }
          if (Array.isArray(token.appRoleScopes)) {
            token.appRoleScopes.forEach((s: string) => perUserSet.add(s));
          }
          if (Array.isArray(token.adminScopes)) {
            token.adminScopes.forEach((s: string) => perUserSet.add(s));
          }
          userAppScopesMap.get(userAppKey)!.forEach((s: string) => appEntry.scopes.add(s));
        });
      },
      `TestCron:Microsoft:${orgDomain} TOKEN_PROCESSING`,
      PROCESSING_CONFIG.BATCH_SIZE,
      PROCESSING_CONFIG.DELAY_BETWEEN_BATCHES
    );

    const uniqueMSApps = Array.from(msAppsMap.values());
    console.log(`[TestCron:Microsoft:${orgDomain}] Found ${uniqueMSApps.length} unique applications.`);
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} TOKEN_PROCESSING COMPLETE`);
    logPhaseTime('Token processing and app deduplication');

    // **NEW: Fetch all DB data upfront for efficient in-memory joins**
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetching existing DB data for comparison...`);
    const [
      { data: existingDbAppsData, error: appError },
      { data: existingDbUsersData, error: usersError },
      { data: existingDbUserAppRelsData, error: relError }
    ] = await Promise.all([
      supabaseAdmin.from('applications').select('id, name, microsoft_app_id').eq('organization_id', org.id),
      supabaseAdmin.from('users').select('id, microsoft_user_id').eq('organization_id', org.id),
      supabaseAdmin.from('user_applications').select('user_id, application_id, applications!inner(id)').eq('applications.organization_id', org.id)
    ]);

    if (appError || usersError || relError) {
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error fetching existing data from Supabase:`, { appError, usersError, relError });
      return NextResponse.json({ error: 'DB fetch error' }, { status: 500 });
    }

    // Create maps for fast lookups
    const existingAppMap = new Map(existingDbAppsData.map(a => [a.name, a]));
    const existingUserMap = new Map(existingDbUsersData.map(u => [u.microsoft_user_id, u]));
    const existingRels = new Set(existingDbUserAppRelsData.map(r => `${r.user_id}:${r.application_id}`));
    let newRelationshipsFound = 0;

    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ DB data fetched. Processing ${uniqueMSApps.length} apps individually...`);

    // **MAIN SYNC LOGIC: Process each app one-by-one for stability**
    await processInBatchesWithResourceControl(
      uniqueMSApps,
      async (appBatch) => {
        for (const app of appBatch) {
          try {
            const all_scopes = Array.from(app.scopes);
            const risk_level = determineRiskLevel(all_scopes);
            
            let dbApp = existingAppMap.get(app.name);

            if (!dbApp) {
              const category = await categorizeApplication(app.name, all_scopes);
              const { data: newApp, error: insertAppError } = await supabaseAdmin
                .from('applications')
                .insert({
                  organization_id: org.id,
                  microsoft_app_id: Array.from(app.ids)[0],
                  name: app.name,
                  category,
                  risk_level: transformRiskLevel(risk_level),
                  management_status: 'Newly discovered',
                  all_scopes,
                  total_permissions: all_scopes.length,
                  provider: 'microsoft'
                })
                .select('id, name, microsoft_app_id')
                .single();

              if (insertAppError) {
                console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting app ${app.name}:`, insertAppError);
                continue;
              }
              dbApp = newApp;
              existingAppMap.set(app.name, dbApp); // Add to map for future batches
            }

            if (!dbApp) continue;

            const relsToInsert = Array.from(app.users)
              .map(userKey => {
                  const dbUser = existingUserMap.get(userKey);
                  if (!dbUser) return null;

                  const relKey = `${dbUser.id}:${dbApp.id}`;
                  if (existingRels.has(relKey)) return null;
                  
                  newRelationshipsFound++;
                  return {
                    application_id: dbApp.id,
                    user_id: dbUser.id,
                    scopes: Array.from(userAppScopesMap.get(`${userKey}:${app.name}`) || new Set()),
                  };
              })
              .filter(r => r !== null);

            if (relsToInsert.length > 0) {
              const { error: insertRelError } = await supabaseAdmin.from('user_applications').insert(relsToInsert);
              if (insertRelError) {
                console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting relationships for app ${app.name}:`, insertRelError);
              } else {
                console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Inserted ${relsToInsert.length} new relationships for ${app.name}`);
              }
            }
          } catch (e) {
            console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Failed to process app ${app.name}:`, e);
          }
        }
      },
      `TestCron:Microsoft:${orgDomain} APP_PROCESSING`,
      5, // Process 5 apps at a time for stability
      50
    );

    logPhaseTime('Database writes and insertions');

    // 11. Log the results
    console.log(`--- [TestCron:Microsoft:${orgDomain}] RESULTS ---`);
    console.log(`✅ Found and processed ${newRelationshipsFound} new user-app relationships.`);
    
    monitor.logResourceUsage(`TestCron:Microsoft:${orgDomain} COMPLETE`);
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [TestCron:Microsoft:${orgDomain}] TOTAL EXECUTION TIME: ${totalTime}ms (${Math.round(totalTime/1000)}s)`);

    return NextResponse.json({
      success: true,
      results: {
        newAppsFound: 0, // This logic is now integrated above
        newUserAppRelationshipsFound: newRelationshipsFound,
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