import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

export const maxDuration = 300; // 5 minutes timeout
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org_id');
    
    if (!orgId) {
      return NextResponse.json({ error: 'org_id parameter is required' }, { status: 400 });
    }

    console.log(`🔍 Analyzing Okta user assignments for org: ${orgId}`);

    // Step 1: Get current Okta relationships from database
    const { data: oktaRelationships, error: dbError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        scopes,
        users!inner(email, microsoft_user_id),
        applications!inner(name, microsoft_app_id)
      `)
      .eq('users.organization_id', orgId)
      .ilike('applications.name', '%okta%');

    if (dbError) {
      throw new Error(`Failed to fetch Okta relationships: ${dbError.message}`);
    }

    console.log(`📊 Found ${oktaRelationships?.length || 0} Okta relationships in database`);

    // Step 2: Get Microsoft credentials and initialize service
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

    const microsoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: 'common'
    });

    await microsoftService.setCredentials({
      refresh_token: syncRecord.refresh_token
    });

    const refreshedTokens = await microsoftService.refreshAccessToken(true);
    if (!refreshedTokens?.id_token) {
      throw new Error("Could not refresh Microsoft tokens");
    }

    const idTokenPayload = JSON.parse(Buffer.from(refreshedTokens.id_token.split('.')[1], 'base64').toString());
    const tenantId = idTokenPayload.tid;

    const correctMicrosoftService = new MicrosoftWorkspaceService({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: tenantId,
    });

    await correctMicrosoftService.setCredentials(refreshedTokens);

    // Step 3: Find Okta service principal
    console.log(`🔍 Finding Okta service principal...`);
    const servicePrincipals = await correctMicrosoftService.getAllPages('/servicePrincipals');
    const oktaServicePrincipals = servicePrincipals.filter((sp: any) => 
      sp.displayName?.toLowerCase().includes('okta') ||
      sp.appDisplayName?.toLowerCase().includes('okta')
    );

    console.log(`📊 Found ${oktaServicePrincipals.length} Okta service principals`);

    // Step 4: For each Okta service principal, analyze assignments
    const oktaAnalysis: any[] = [];

    for (const sp of oktaServicePrincipals) {
      console.log(`🔹 Analyzing: ${sp.displayName} (${sp.appId})`);
      
      try {
        // Get app role assignments for this service principal
        const appRoleAssignments = await correctMicrosoftService.client.api(`/servicePrincipals/${sp.id}/appRoleAssignedTo`).get();
        
        // Get OAuth permission grants for this service principal
        const oauthGrants = await correctMicrosoftService.client.api('/oauth2PermissionGrants')
          .filter(`resourceId eq '${sp.id}'`)
          .get();
        
        // Get admin consent grants
        const adminGrants = await correctMicrosoftService.client.api('/oauth2PermissionGrants')
          .filter(`consentType eq 'AllPrincipals' and resourceId eq '${sp.id}'`)
          .get();
        
        const analysis = {
          servicePrincipal: {
            id: sp.id,
            appId: sp.appId,
            displayName: sp.displayName,
            appDisplayName: sp.appDisplayName
          },
          appRoleAssignments: {
            count: appRoleAssignments?.value?.length || 0,
            assignments: appRoleAssignments?.value?.map((assignment: any) => ({
              principalId: assignment.principalId,
              principalType: assignment.principalType,
              principalDisplayName: assignment.principalDisplayName,
              appRoleId: assignment.appRoleId,
              createdDateTime: assignment.createdDateTime
            })) || []
          },
          userOAuthGrants: {
            count: oauthGrants?.value?.filter((g: any) => g.consentType !== 'AllPrincipals').length || 0,
            grants: oauthGrants?.value?.filter((g: any) => g.consentType !== 'AllPrincipals').map((grant: any) => ({
              principalId: grant.principalId,
              consentType: grant.consentType,
              scope: grant.scope
            })) || []
          },
          adminConsent: {
            count: adminGrants?.value?.length || 0,
            grants: adminGrants?.value?.map((grant: any) => ({
              consentType: grant.consentType,
              scope: grant.scope,
              clientId: grant.clientId
            })) || []
          }
        };
        
        oktaAnalysis.push(analysis);
        
      } catch (error) {
        console.error(`❌ Error analyzing ${sp.displayName}:`, error);
        oktaAnalysis.push({
          servicePrincipal: {
            id: sp.id,
            appId: sp.appId,
            displayName: sp.displayName,
            appDisplayName: sp.appDisplayName
          },
          error: (error as Error).message
        });
      }
    }

    // Step 5: Summary
    const summary = {
      databaseRelationships: oktaRelationships?.length || 0,
      oktaServicePrincipals: oktaServicePrincipals.length,
      totalAppRoleAssignments: oktaAnalysis.reduce((sum, analysis) => 
        sum + (analysis.appRoleAssignments?.count || 0), 0),
      totalUserOAuthGrants: oktaAnalysis.reduce((sum, analysis) => 
        sum + (analysis.userOAuthGrants?.count || 0), 0),
      totalAdminConsents: oktaAnalysis.reduce((sum, analysis) => 
        sum + (analysis.adminConsent?.count || 0), 0)
    };

    const result = {
      organizationId: orgId,
      tenantId: tenantId,
      summary,
      databaseRelationships: oktaRelationships?.map(rel => ({
        userEmail: (rel.users as any).email,
        appName: (rel.applications as any).name,
        appId: (rel.applications as any).microsoft_app_id,
        scopes: rel.scopes
      })),
      oktaAnalysis
    };

    console.log(`✅ Okta analysis completed`);
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Okta analysis error:', error);
    return NextResponse.json({ 
      error: 'Okta analysis failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
