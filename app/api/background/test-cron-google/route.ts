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
      .eq('domain', 'stitchflow.io')
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

    // 5. Fetch all users and apps from Google Workspace
    console.log('[StitchflowTestCron] Fetching data from Google Workspace API...');
    const [allGoogleUsers, allGoogleApps] = await Promise.all([
      googleService.getUsersListPaginated(),
      googleService.getOAuthTokens()
    ]);
    console.log(`[StitchflowTestCron] Fetched ${allGoogleUsers.length} users and ${allGoogleApps.length} apps from Google.`);

    // 6. Fetch existing users and apps from the Supabase database
    console.log('[StitchflowTestCron] Fetching existing data from Supabase DB...');
    const [
      { data: existingDbUsers, error: userError },
      { data: existingDbApps, error: appError }
    ] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('google_user_id')
        .eq('organization_id', org.id),
      supabaseAdmin
        .from('applications')
        .select('google_app_id')
        .eq('organization_id', org.id)
    ]);

    if (userError || appError) {
      console.error('[StitchflowTestCron] ❌ Error fetching existing data from Supabase:', { userError, appError });
      return NextResponse.json({ error: 'DB fetch error' }, { status: 500 });
    }

    // 7. Compare the datasets to find what's new
    console.log('[StitchflowTestCron] 🔍 Comparing datasets to find new entries...');

    // Find new users
    const existingUserIds = new Set(existingDbUsers?.map((u: { google_user_id: string }) => u.google_user_id) || []);
    const newUsers = allGoogleUsers.filter((u: any) => !existingUserIds.has(u.id));

    // Find new apps
    const existingAppIds = new Set(existingDbApps?.map((a: { google_app_id: string }) => a.google_app_id) || []);
    const newApps = allGoogleApps.filter((app: any) => !existingAppIds.has(app.clientId));

    // 8. Log the results
    console.log('--- [StitchflowTestCron] RESULTS ---');
    
    if (newUsers.length > 0) {
      console.log(`✅ Found ${newUsers.length} new users:`);
      newUsers.forEach((user: any) => {
        console.log(`  - Name: ${user.name.fullName}, Email: ${user.primaryEmail}, Google ID: ${user.id}`);
      });
    } else {
      console.log('✅ No new users found.');
    }

    if (newApps.length > 0) {
      console.log(`✅ Found ${newApps.length} new apps:`);
      newApps.forEach((app: any) => {
        console.log(`  - Name: ${app.displayName}, App ID: ${app.clientId}, Scopes: ${app.scopes.length}`);
      });
    } else {
      console.log('✅ No new apps found.');
    }
    
    console.log('--- [StitchflowTestCron] END RESULTS ---');
    console.log('[StitchflowTestCron] ✅ Test run completed successfully.');

    return NextResponse.json({
      success: true,
      message: 'Test cron for Stitchflow completed successfully.',
      results: {
        newUsersFound: newUsers.length,
        newAppsFound: newApps.length,
        newUsers: newUsers.map((u: any) => ({ name: u.name.fullName, email: u.primaryEmail })),
        newApps: newApps.map((a: any) => ({ name: a.displayName, id: a.clientId }))
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