import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';

/**
 * A test cron job specifically for the Stitchflow organization.
 * This job fetches and compares user and application data from Google Workspace against the database and logs the differences without sending notifications or triggering a full sync.
 *
 * It does NOT:
 * - Trigger a full background sync.
 * - Write any data to the database.
 * - Send any email notifications.
 */
export async function POST(request: Request) {
  // 1. Authenticate the request using a secret bearer token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];

  if (token !== process.env.CRON_SECRET) {
    console.error('[StitchflowTestCron] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🚀 [StitchflowTestCron] Starting Stitchflow test cron job...');

  try {
    // 2. Find the 'stitchflow.io' organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, auth_provider')
      .eq('domain', 'fountain.com')
      .single();

    if (orgError || !org) {
      console.error('[StitchflowTestCron] Could not find organization "stitchflow.io":', orgError);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (org.auth_provider !== 'google') {
      console.error(`[StitchflowTestCron] "stitchflow.io" is not a Google Workspace organization.`);
      return NextResponse.json({ error: 'Organization is not a Google provider' }, { status: 400 });
    }
    
    console.log(`[StitchflowTestCron] ✅ Found organization: ${org.name} (${org.id})`);

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
      console.error(`[StitchflowTestCron] ❌ ${errorMsg}`, syncError?.message);
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
      console.error(`[StitchflowTestCron] ❌ ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 404 });
    }

    console.log(`[StitchflowTestCron] ✅ Found admin-scoped tokens for user ${bestToken.user_email}.`);

    // 4. Initialize GoogleWorkspaceService and refresh the access token
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });

    googleService.setCredentials({ refresh_token: bestToken.refresh_token });
    const refreshedTokens = await googleService.refreshAccessToken(true);

    if (!refreshedTokens || !refreshedTokens.access_token) {
      const errorMsg = 'Failed to refresh access token.';
      console.error(`[StitchflowTestCron] ❌ ${errorMsg}`);
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
    
    console.log('[StitchflowTestCron] ✅ Successfully refreshed access token.');

    // 5. Fetch all users and app tokens from Google Workspace
    console.log('[StitchflowTestCron] Fetching data from Google Workspace API...');
    const [allGoogleUsers, allGoogleTokens] = await Promise.all([
      googleService.getUsersListPaginated(),
      googleService.getOAuthTokens()
    ]);
    console.log(`[StitchflowTestCron] Fetched ${allGoogleUsers.length} users and ${allGoogleTokens.length} total app tokens from Google.`);

    // Create a lookup map for user email/name by Google ID for easier logging
    const googleUserMap = new Map(allGoogleUsers.map((u: any) => [u.id, { email: u.primaryEmail, name: u.name.fullName }]));

    // 6. Process and de-duplicate applications from the raw token list
    console.log('[StitchflowTestCron] De-duplicating application list...');
    const googleAppsMap = new Map<string, { id: string; name: string; users: Set<string> }>();

    allGoogleTokens.forEach((token: any) => {
      if (!token.clientId) return;

      if (!googleAppsMap.has(token.clientId)) {
        googleAppsMap.set(token.clientId, {
          id: token.clientId,
          name: token.displayText || 'Unknown App',
          users: new Set<string>(),
        });
      }
      googleAppsMap.get(token.clientId)!.users.add(token.userKey);
    });

    const uniqueGoogleApps = Array.from(googleAppsMap.values());
    console.log(`[StitchflowTestCron] Found ${uniqueGoogleApps.length} unique applications.`);


    // 7. Fetch existing data from the Supabase database
    console.log('[StitchflowTestCron] Fetching existing data from Supabase DB...');
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
      console.error('[StitchflowTestCron] ❌ Error fetching existing data from Supabase:', { appError, relError });
      return NextResponse.json({ error: 'DB fetch error' }, { status: 500 });
    }

    // 8. Compare datasets to find what's new
    console.log('[StitchflowTestCron] 🔍 Comparing datasets to find new entries...');

    // Find new applications by name
    const existingAppNames = new Set(existingDbApps?.map((a: any) => a.name) || []);
    const newApps = uniqueGoogleApps.filter(app => !existingAppNames.has(app.name));

    // Find new user-application relationships by user Google ID and app name
    const dbUserAppRelsByName = new Set(existingDbUserAppRels?.map((r: any) => r.user && r.application ? `${r.user.google_user_id}:${r.application.name}` : null).filter(Boolean) || []);
    const newRelationships: { user: any; app: any; }[] = [];
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
                        newRelationships.push({ user, app });
                        processedRelsForReport.add(reportId);
                    }
                }
            }
        });
    });


    // 9. Log the results
    console.log('--- [StitchflowTestCron] RESULTS ---');
    
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
    
    console.log('--- [StitchflowTestCron] END RESULTS ---');
    console.log('[StitchflowTestCron] ✅ Test run completed successfully.');

    return NextResponse.json({
      success: true,
      message: 'Test cron for Stitchflow completed successfully.',
      results: {
        newAppsFound: newApps.length,
        newUserAppRelationshipsFound: newRelationships.length,
        newApps: newApps.map((a: any) => ({ name: a.name, id: a.id, userCount: a.users.size })),
        newUserAppRelationships: newRelationships.map(r => ({ userName: r.user.name, userEmail: r.user.email, appName: r.app.name }))
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[StitchflowTestCron] ❌ An unexpected error occurred:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
} 