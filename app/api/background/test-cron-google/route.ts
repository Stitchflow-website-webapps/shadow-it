import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    // 1. Authenticate the request
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    
    if (token !== process.env.CRON_SECRET) {
      console.error('Unauthorized cron test request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orgDomain = 'stitchflow.io';
    console.log(`[CRON TEST] Starting test for organization: ${orgDomain}`);

    // 2. Get the specific organization
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, google_org_id, auth_provider')
      .eq('domain', orgDomain)
      .single();

    if (orgError) {
      console.error(`[CRON TEST] Error fetching organization ${orgDomain}:`, orgError);
      return NextResponse.json({ error: `Error fetching organization ${orgDomain}` }, { status: 500 });
    }

    if (!organization) {
      console.log(`[CRON TEST] Organization ${orgDomain} not found.`);
      return NextResponse.json({ message: `Organization ${orgDomain} not found` });
    }

    if (organization.auth_provider !== 'google') {
        return NextResponse.json({ message: `Organization ${orgDomain} is not a google provider` });
    }

    // 3. Trigger background sync for this organization
    await triggerTestBackgroundSync(organization);

    return NextResponse.json({ 
      success: true, 
      message: `Sync triggered for ${orgDomain}`
    });
  } catch (error) {
    console.error('[CRON TEST] Error in test cron job:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function triggerTestBackgroundSync(org: any) {
  const provider = 'google';
  try {
    console.log(`[CRON TEST] ⚙️ Triggering background sync for ${provider} org ${org.id}...`);

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
      console.error(`[CRON TEST] ❌ Could not find any tokens in sync_status for ${provider} org ${org.id}. Error:`, syncError?.message);
      console.error(`[CRON TEST] This indicates the user hasn't completed the admin consent flow properly.`);
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
      
      const tokenScopes = token.scope ? token.scope.split(' ') : [];
      const hasRequiredAdminScopes = requiredAdminScopes.every(scope => 
        tokenScopes.includes(scope)
      );
      
      if (hasRequiredAdminScopes) {
        bestToken = token;
        console.log('[CRON TEST] ✅ Found admin-scoped token with scopes:', token.scope);
        break; 
      }
    }

    if (!bestToken) {
      console.error(`[CRON TEST] ❌ Could not find admin-scoped tokens in sync_status for ${provider} org ${org.id}.`);
      return;
    }

    // Create a new sync_status record for this cron-triggered run
    const { data: newSyncStatus, error: createError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: org.id,
        user_email: bestToken.user_email,
        status: 'IN_PROGRESS',
        progress: 5,
        message: `Background sync initiated by test cron for ${provider}.`,
        provider: provider,
        access_token: bestToken.access_token,
        refresh_token: bestToken.refresh_token,
      })
      .select('id')
      .single();

    if (createError) {
      console.error(`[CRON TEST] ❌ Failed to create new sync status for cron run (org ${org.id}):`, createError);
      return;
    }

    const sync_id = newSyncStatus.id;
    console.log(`[CRON TEST] ✅ Created new sync record ${sync_id} for org ${org.id}.`);

    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://www.stitchflow.com/tools/shadow-it-scan'
      : 'http://localhost:3000';

    const syncUrl = `${baseUrl}/api/background/sync`;

    // Fire-and-forget the sync process.
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
      console.error(`[CRON TEST] ❌ Fetch error triggering background sync for org ${org.id}:`, fetchError);
      supabaseAdmin
        .from('sync_status')
        .update({ status: 'FAILED', message: `Cron failed to trigger sync endpoint: ${fetchError.message}` })
        .eq('id', sync_id);
    });

    console.log(`[CRON TEST] ▶️ Successfully dispatched sync request for ${provider} org ${org.id}.`);

  } catch (error) {
    console.error(`[CRON TEST] ❌ Error in triggerBackgroundSync for org ${org.id}:`, error);
  }
} 