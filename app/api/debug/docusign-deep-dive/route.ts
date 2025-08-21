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

    console.log(`🔍 Deep dive analysis for DocuSign app for org: ${orgId}`);

    // Step 1: Get DocuSign app relationships from database
    const { data: docusignRelationships, error: dbError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        scopes,
        created_at,
        users!inner(email, microsoft_user_id),
        applications!inner(name, microsoft_app_id)
      `)
      .eq('users.organization_id', orgId)
      .eq('applications.name', 'Docusign'); // EXACT match for DocuSign app only

    if (dbError) {
      throw new Error(`Failed to fetch DocuSign relationships: ${dbError.message}`);
    }

    console.log(`📊 Found ${docusignRelationships?.length || 0} DocuSign relationships in database`);

    // Step 2: Initialize Microsoft service
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

    // Step 3: Find DocuSign service principal by searching for it
    console.log(`🔍 Finding DocuSign service principal...`);
    const servicePrincipals = await correctMicrosoftService.getAllPages('/servicePrincipals');
    const docusignServicePrincipal = servicePrincipals.find((sp: any) => 
      sp.displayName?.toLowerCase().includes('docusign') ||
      sp.appDisplayName?.toLowerCase().includes('docusign')
    );

    if (!docusignServicePrincipal) {
      return NextResponse.json({ error: 'DocuSign service principal not found' }, { status: 404 });
    }

    console.log(`✅ Found DocuSign service principal: ${docusignServicePrincipal.displayName} (${docusignServicePrincipal.appId})`);

    // Step 4: Analyze DocuSign assignments
    console.log(`🔍 Analyzing DocuSign assignments...`);

    // Get app role assignments for DocuSign
    const appRoleAssignments = await correctMicrosoftService.client.api(`/servicePrincipals/${docusignServicePrincipal.id}/appRoleAssignedTo`).get();
    
    // Get OAuth permission grants for DocuSign
    const oauthGrants = await correctMicrosoftService.client.api('/oauth2PermissionGrants')
      .filter(`resourceId eq '${docusignServicePrincipal.id}'`)
      .get();

    // Get admin consent grants for DocuSign
    const adminGrants = await correctMicrosoftService.client.api('/oauth2PermissionGrants')
      .filter(`consentType eq 'AllPrincipals' and resourceId eq '${docusignServicePrincipal.id}'`)
      .get();

    // Step 5: Get active member users for analysis
    const activeMemberUsers = await correctMicrosoftService.getUsersList(false, false);
    console.log(`👥 Found ${activeMemberUsers.length} active member users`);

    // Step 6: Analyze group assignments in detail
    console.log(`🔍 Analyzing DocuSign group assignments...`);
    const groupAnalysis: any[] = [];
    const allGroupMemberEmails = new Set<string>();

    for (const assignment of appRoleAssignments?.value || []) {
      if (assignment.principalType === 'Group') {
        console.log(`📊 Analyzing group: ${assignment.principalDisplayName}`);
        
        // Get ALL group members (paginated)
        const groupMembers = await correctMicrosoftService.getAllPages(`/groups/${assignment.principalId}/members`);
        const memberCount = groupMembers?.length || 0;
        
        console.log(`   📊 Found ${memberCount} total members in group ${assignment.principalDisplayName}`);
        
        // Filter to active members only and get detailed info
        const activeMemberEmails = new Set(activeMemberUsers.map(u => (u.mail || u.userPrincipalName)?.toLowerCase()));
        const activeGroupMembers = groupMembers?.filter((member: any) => {
          const memberEmail = (member.mail || member.userPrincipalName)?.toLowerCase();
          return memberEmail && activeMemberEmails.has(memberEmail);
        }) || [];

        // Get detailed member information
        const memberDetails = activeGroupMembers.map((member: any) => {
          const email = (member.mail || member.userPrincipalName)?.toLowerCase();
          allGroupMemberEmails.add(email);
          return {
            email: email,
            displayName: member.displayName,
            userType: member.userType || 'Unknown',
            accountEnabled: member.accountEnabled
          };
        });

        groupAnalysis.push({
          groupName: assignment.principalDisplayName,
          groupId: assignment.principalId,
          totalMembers: memberCount,
          activeMembersInGroup: activeGroupMembers.length,
          memberDetails: memberDetails,
          appRoleId: assignment.appRoleId,
          createdDateTime: assignment.createdDateTime
        });
      }
    }

    console.log(`📊 Total unique active members from all groups: ${allGroupMemberEmails.size}`);

    // Step 7: Analyze individual user assignments
    console.log(`🔍 Analyzing individual DocuSign user assignments...`);
    const individualUserEmails = new Set<string>();
    const individualUserDetails: any[] = [];

    for (const assignment of appRoleAssignments?.value || []) {
      if (assignment.principalType === 'User') {
        console.log(`👤 Individual assignment: ${assignment.principalDisplayName}`);
        
        try {
          // Get user details
          const userDetails = await correctMicrosoftService.client.api(`/users/${assignment.principalId}`).get();
          const email = (userDetails.mail || userDetails.userPrincipalName)?.toLowerCase();
          
          if (email) {
            individualUserEmails.add(email);
            individualUserDetails.push({
              email: email,
              displayName: userDetails.displayName,
              userType: userDetails.userType || 'Unknown',
              accountEnabled: userDetails.accountEnabled,
              appRoleId: assignment.appRoleId,
              createdDateTime: assignment.createdDateTime
            });
          }
        } catch (error) {
          console.warn(`⚠️ Could not fetch details for user ${assignment.principalId}: ${error}`);
        }
      }
    }

    console.log(`📊 Total individual user assignments: ${individualUserEmails.size}`);

    // Step 8: Calculate total expected users (groups + individuals, removing duplicates)
    const allExpectedUserEmails = new Set([...allGroupMemberEmails, ...individualUserEmails]);
    console.log(`📊 Total expected unique users (groups + individuals): ${allExpectedUserEmails.size}`);

    // Step 9: Sample token creation simulation
    console.log(`🔍 Simulating token creation process for DocuSign...`);
    
    const tokenCreationAnalysis: any[] = [];
    const processedEmails = new Set();

    for (const user of activeMemberUsers.slice(0, 10)) { // Sample first 10 users for detailed analysis
      const userEmail = user.mail || user.userPrincipalName;
      if (!userEmail || processedEmails.has(userEmail)) continue;
      processedEmails.add(userEmail);

      console.log(`🔹 Analyzing user: ${userEmail}`);

      // Check if user has direct app role assignment to DocuSign
      const allUserAppRoleAssignments = await correctMicrosoftService.client.api(`/users/${user.id}/appRoleAssignments`).get();
      const userDocuSignAssignments = {
        value: allUserAppRoleAssignments?.value?.filter((assignment: any) => 
          assignment.resourceId === docusignServicePrincipal.id
        ) || []
      };

      // Check if user has OAuth grants for DocuSign
      const allOAuthGrants = await correctMicrosoftService.client.api('/oauth2PermissionGrants')
        .filter(`principalId eq '${user.id}'`)
        .get();
      const userOAuthGrants = {
        value: allOAuthGrants?.value?.filter((grant: any) => 
          grant.resourceId === docusignServicePrincipal.id
        ) || []
      };

      // Check group memberships that might give access
      const userGroups = await correctMicrosoftService.client.api(`/users/${user.id}/memberOf`).get();
      const relevantGroups = userGroups?.value?.filter((group: any) => 
        group.displayName === 'All Users' || group.displayName === 'IT/Infosec' || 
        group.displayName?.toLowerCase().includes('docusign')
      ) || [];

      const analysis = {
        userEmail,
        hasDirectAppRoleAssignment: userDocuSignAssignments?.value?.length > 0,
        hasOAuthGrants: userOAuthGrants?.value?.length > 0,
        relevantGroupMemberships: relevantGroups.map((g: any) => g.displayName),
        wouldGetToken: false,
        tokenCreationReason: ''
      };

      // Determine if this user would get a token and why
      if (analysis.hasDirectAppRoleAssignment) {
        analysis.wouldGetToken = true;
        analysis.tokenCreationReason = 'Direct app role assignment';
      } else if (relevantGroups.length > 0) {
        analysis.wouldGetToken = true;
        analysis.tokenCreationReason = `Group membership: ${relevantGroups.map((g: any) => g.displayName).join(', ')}`;
      } else if (analysis.hasOAuthGrants) {
        analysis.wouldGetToken = true;
        analysis.tokenCreationReason = 'OAuth permission grants';
      }

      tokenCreationAnalysis.push(analysis);
    }

    // Get emails from database relationships
    const dbUserEmails = docusignRelationships?.map(rel => (rel.users as any).email.toLowerCase()) || [];

    const result = {
      organizationId: orgId,
      tenantId: tenantId,
      docusignApp: {
        appId: docusignServicePrincipal.appId,
        displayName: docusignServicePrincipal.displayName,
        servicePrincipalId: docusignServicePrincipal.id
      },
      databaseAnalysis: {
        totalRelationships: docusignRelationships?.length || 0,
        userEmails: dbUserEmails,
        sampleRelationships: docusignRelationships?.slice(0, 5).map(rel => ({
          userEmail: (rel.users as any).email,
          scopes: rel.scopes,
          createdAt: rel.created_at
        }))
      },
      microsoftAnalysis: {
        totalAppRoleAssignments: appRoleAssignments?.value?.length || 0,
        individualUserAssignments: appRoleAssignments?.value?.filter((a: any) => a.principalType === 'User').length || 0,
        groupAssignments: appRoleAssignments?.value?.filter((a: any) => a.principalType === 'Group').length || 0,
        totalOAuthGrants: oauthGrants?.value?.length || 0,
        totalAdminConsents: adminGrants?.value?.length || 0
      },
      detailedAssignmentAnalysis: {
        groupAssignments: groupAnalysis,
        individualUserAssignments: {
          count: individualUserEmails.size,
          users: individualUserDetails
        },
        combinedAnalysis: {
          totalUniqueUsersFromGroups: allGroupMemberEmails.size,
          totalIndividualUsers: individualUserEmails.size,
          totalExpectedUniqueUsers: allExpectedUserEmails.size,
          expectedUsersList: Array.from(allExpectedUserEmails).sort()
        }
      },
      tokenCreationSimulation: {
        sampleSize: tokenCreationAnalysis.length,
        usersWhoWouldGetTokens: tokenCreationAnalysis.filter(u => u.wouldGetToken).length,
        tokenCreationReasons: tokenCreationAnalysis.reduce((acc: any, user) => {
          if (user.wouldGetToken) {
            acc[user.tokenCreationReason] = (acc[user.tokenCreationReason] || 0) + 1;
          }
          return acc;
        }, {}),
        detailedAnalysis: tokenCreationAnalysis
      },
      comparison: {
        databaseUsers: dbUserEmails.length,
        expectedUsersFromMicrosoft: allExpectedUserEmails.size,
        sampleDatabaseUsers: dbUserEmails.slice(0, 10) // First 10 users in database
      },
      conclusion: {
        rootCause: 'Similar to Okta - group assignments are being expanded to individual user relationships during sync',
        specificIssue: 'DocuSign likely has similar group assignment pattern as Okta',
        recommendation: 'Check if DocuSign also has "All Users" group assignment causing the same expansion issue'
      }
    };

    console.log(`✅ Deep dive analysis completed for DocuSign app`);
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ DocuSign deep dive analysis error:', error);
    return NextResponse.json({ 
      error: 'DocuSign deep dive analysis failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
