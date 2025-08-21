import { NextRequest, NextResponse } from 'next/server';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org_id');
    const includeGuests = searchParams.get('include_guests') === 'true';
    const includeDisabled = searchParams.get('include_disabled') === 'true';
    
    if (!orgId) {
      return NextResponse.json({ error: 'org_id parameter is required' }, { status: 400 });
    }

    console.log(`🧪 Testing Microsoft user filtering for org: ${orgId}`);
    console.log(`📋 Filters: includeGuests=${includeGuests}, includeDisabled=${includeDisabled}`);

    // Get Microsoft credentials for this organization
    const { data: syncRecord, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', orgId)
      .eq('provider', 'microsoft')
      .not('refresh_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (syncError || !syncRecord) {
      return NextResponse.json({ 
        error: 'No Microsoft sync credentials found for this organization' 
      }, { status: 404 });
    }

    // Initialize Microsoft service
    console.log('🔑 Initializing Microsoft service...');
    const microsoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: 'common'
    });

    await microsoftService.setCredentials({
      refresh_token: syncRecord.refresh_token
    });

    // Refresh tokens
    const refreshedTokens = await microsoftService.refreshAccessToken(true);
    if (!refreshedTokens?.id_token) {
      throw new Error("Could not refresh Microsoft tokens");
    }

    // Extract tenant ID and re-initialize
    const idTokenPayload = JSON.parse(Buffer.from(refreshedTokens.id_token.split('.')[1], 'base64').toString());
    const tenantId = idTokenPayload.tid;

    const correctMicrosoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: tenantId,
    });

    await correctMicrosoftService.setCredentials(refreshedTokens);

    console.log('✅ Microsoft service initialized');

    // Test different filtering scenarios
    const results = {
      organizationId: orgId,
      tenantId: tenantId,
      testResults: {} as any
    };

    // Test 1: Members only (default)
    console.log('🧪 Test 1: Members only (default behavior)');
    const membersOnly = await correctMicrosoftService.getUsersList(false, false);
    results.testResults.membersOnly = {  
      count: membersOnly.length,
      breakdown: getMemberBreakdown(membersOnly),
      allEmails: membersOnly.map(u => ({
        email: u.mail || u.userPrincipalName,
        displayName: u.displayName,
        userType: u.userType,
        accountEnabled: u.accountEnabled
      })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    };

    // Test 2: Include guests
    console.log('🧪 Test 2: Include guests');
    const withGuests = await correctMicrosoftService.getUsersList(true, false);
    results.testResults.withGuests = {
      count: withGuests.length,
      breakdown: getMemberBreakdown(withGuests),
      allEmails: withGuests.map(u => ({
        email: u.mail || u.userPrincipalName,
        displayName: u.displayName,
        userType: u.userType,
        accountEnabled: u.accountEnabled
      })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    };

    // Test 3: Include all (guests + disabled)
    console.log('🧪 Test 3: Include all users');
    const allUsers = await correctMicrosoftService.getUsersList(true, true);
    results.testResults.allUsers = {
      count: allUsers.length,
      breakdown: getMemberBreakdown(allUsers),
      allEmails: allUsers.map(u => ({
        email: u.mail || u.userPrincipalName,
        displayName: u.displayName,
        userType: u.userType,
        accountEnabled: u.accountEnabled
      })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    };

    // Separate member vs guest analysis
    const memberUsers = allUsers.filter(u => u.userType === 'Member');
    const guestUsers = allUsers.filter(u => u.userType === 'Guest');
    const otherUsers = allUsers.filter(u => u.userType !== 'Member' && u.userType !== 'Guest');

    results.detailedAnalysis = {
      members: {
        count: memberUsers.length,
        emails: memberUsers.map(u => ({
          email: u.mail || u.userPrincipalName,
          displayName: u.displayName,
          accountEnabled: u.accountEnabled
        })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
      },
      guests: {
        count: guestUsers.length,
        emails: guestUsers.map(u => ({
          email: u.mail || u.userPrincipalName,
          displayName: u.displayName,
          accountEnabled: u.accountEnabled
        })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
      },
      others: {
        count: otherUsers.length,
        emails: otherUsers.map(u => ({
          email: u.mail || u.userPrincipalName,
          displayName: u.displayName,
          userType: u.userType,
          accountEnabled: u.accountEnabled
        })).sort((a, b) => (a.email || '').localeCompare(b.email || ''))
      }
    };

    // Summary
    results.summary = {
      reductionFromFiltering: {
        allUsersToMembers: `${allUsers.length} → ${membersOnly.length} (${Math.round((1 - membersOnly.length/allUsers.length) * 100)}% reduction)`,
        withGuestsToMembers: `${withGuests.length} → ${membersOnly.length} (${Math.round((1 - membersOnly.length/withGuests.length) * 100)}% reduction)`
      },
      userTypeBreakdown: {
        members: memberUsers.length,
        guests: guestUsers.length,
        others: otherUsers.length,
        total: allUsers.length
      }
    };

    console.log('✅ Testing completed successfully');
    return NextResponse.json(results);

  } catch (error) {
    console.error('❌ Test error:', error);
    return NextResponse.json({ 
      error: 'Test failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}

function getMemberBreakdown(users: any[]) {
  return users.reduce((acc, user) => {
    const type = user.userType || 'Unknown';
    const enabled = user.accountEnabled ? 'Enabled' : 'Disabled';
    const key = `${type} (${enabled})`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}
