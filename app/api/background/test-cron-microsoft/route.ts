import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { determineRiskLevel, transformRiskLevel } from '@/lib/risk-assessment';
import { categorizeApplication } from '@/app/api/background/sync/categorize/route';

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
      const errorMsg = 'Failed to refresh access token or missing id_token.';
      console.error(`[TestCron:Microsoft:${orgDomain}] ❌ ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 500 });
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

    // 5. Fetch all users and app tokens from Microsoft Graph API
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetching data from Microsoft Graph API...`);
    const [allMSUsers, allMSAppTokens] = await Promise.all([
      microsoftService.getUsersList(),
      microsoftService.getOAuthTokens()
    ]);
    console.log(`[TestCron:Microsoft:${orgDomain}] Fetched ${allMSUsers.length} users and ${allMSAppTokens.length} total app tokens from Microsoft.`);

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

      const { error: insertUsersError } = await supabaseAdmin.from('users').insert(usersToInsert);

      if (insertUsersError) {
        console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting new users:`, insertUsersError);
      } else {
        console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully inserted ${newMSUsers.length} new users.`);
      }
    } else {
      console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Users table is already up to date.`);
    }

    const msUserMap = new Map(allMSUsers.map((u: any) => [u.id, { email: u.mail, name: u.displayName }]));

    // 7. De-duplicate applications by name
    console.log(`[TestCron:Microsoft:${orgDomain}] De-duplicating application list...`);
    const msAppsMap = new Map<string, { ids: Set<string>; name: string; users: Set<string>; scopes: Set<string>; }>();
    const userAppScopesMap = new Map<string, Set<string>>();

    allMSAppTokens.forEach((token: any) => {
        if (!token.clientId || !token.userKey || !token.displayText) return;

        if (!msAppsMap.has(token.displayText)) {
            msAppsMap.set(token.displayText, {
                ids: new Set<string>(),
                name: token.displayText,
                users: new Set<string>(),
                scopes: new Set<string>(),
            });
        }
        const appEntry = msAppsMap.get(token.displayText)!;
        appEntry.ids.add(token.clientId);
        appEntry.users.add(token.userKey);
        (token.scopes || []).forEach((s: string) => appEntry.scopes.add(s));
        
        const userAppKey = `${token.userKey}:${token.clientId}`;
        if (!userAppScopesMap.has(userAppKey)) {
          userAppScopesMap.set(userAppKey, new Set<string>());
        }
        (token.scopes || []).forEach((s: string) => userAppScopesMap.get(userAppKey)!.add(s));
    });

    const uniqueMSApps = Array.from(msAppsMap.values());
    console.log(`[TestCron:Microsoft:${orgDomain}] Found ${uniqueMSApps.length} unique applications.`);

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

      // Insert new applications
      if (newApps.length > 0) {
        /*
        const appsToInsert = await Promise.all(newApps.map(async (app) => {
          const all_scopes = Array.from(app.scopes);
          const risk_level = determineRiskLevel(all_scopes);
          const category = await categorizeApplication(app.name, all_scopes);
          return {
            organization_id: org.id,
            microsoft_app_id: Array.from(app.ids)[0], // Store one of the client IDs
            name: app.name,
            category,
            risk_level: transformRiskLevel(risk_level),
            all_scopes,
            total_permissions: all_scopes.length,
            provider: 'microsoft'
          };
        }));
        
        const { data: insertedApps, error: insertAppsError } = await supabaseAdmin
          .from('applications')
          .insert(appsToInsert)
          .select('id, name');

        if (insertAppsError) {
          console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting new applications:`, insertAppsError);
        } else {
          console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully inserted ${insertedApps.length} new applications.`);
          insertedApps.forEach(a => appNameToDbIdMap.set(a.name, a.id));
        }
        */
      }

      // Insert new user-application relationships
      if (newRelationships.length > 0) {
        /*
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
            
            // For MS, we have to find the specific client ID this user token was for
            // This is a simplification; we find a clientId associated with this user for this app
            const relevantClientId = allMSAppTokens.find(t => t.userKey === rel.userKey && t.displayText === rel.app.name)?.clientId;
            if (!relevantClientId) return [];

            const scopesSet = userAppScopesMap.get(`${rel.userKey}:${relevantClientId}`) || new Set();
            
            return [{ application_id, user_id, scopes: Array.from(scopesSet) }];
          });

          if (relsToInsert.length > 0) {
            const { error: insertRelsError } = await supabaseAdmin.from('user_applications').insert(relsToInsert as any);
            if (insertRelsError) {
              console.error(`[TestCron:Microsoft:${orgDomain}] ❌ Error inserting new relationships:`, insertRelsError);
            } else {
              console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Successfully inserted ${relsToInsert.length} new user-app relationships.`);
            }
          }
        }
        */
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
        newRelationships.sort((a,b) => a.user.email.localeCompare(b.user.email) || a.app.name.localeCompare(b.app.name));
        newRelationships.forEach(rel => console.log(`  - User: ${rel.user.name} (${rel.user.email}) to App: ${rel.app.name}`));
    } else {
        console.log('✅ No new user-app relationships found.');
    }
    console.log(`--- [TestCron:Microsoft:${orgDomain}] END RESULTS ---`);
    console.log(`[TestCron:Microsoft:${orgDomain}] ✅ Test run for ${orgDomain} completed successfully.`);

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
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
} 