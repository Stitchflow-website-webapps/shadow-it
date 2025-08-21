import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

export const maxDuration = 1800; // 30 minutes timeout (reduced for better reliability)
export const dynamic = 'force-dynamic';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  try {
    const { organization_id, dry_run = true } = await request.json();
    
    if (!organization_id) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    console.log(`🧹 Starting Microsoft user-app cleanup for organization: ${organization_id}`);
    console.log(`🔍 Mode: ${dry_run ? 'DRY RUN (no changes)' : 'LIVE (will make changes)'}`);

    // Step 1: Get organization info
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', organization_id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    console.log(`✅ Found organization: ${org.name} (${org.domain})`);

    // Step 2: Get Microsoft credentials for this organization
    const { data: syncRecord, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', organization_id)
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

    console.log(`✅ Found Microsoft sync credentials`);

    // Step 3: Initialize Microsoft service to get actual user assignments
    console.log(`🔑 Initializing Microsoft service...`);
    
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

    console.log(`✅ Microsoft service initialized for tenant: ${tenantId}`);

    // Step 4: Get all current user-app relationships from database
    console.log(`📊 Fetching current user-app relationships from database...`);
    
    const { data: currentRelationships, error: relationshipsError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        scopes,
        users!inner(email, microsoft_user_id, organization_id),
        applications!inner(name, microsoft_app_id, organization_id)
      `)
      .eq('users.organization_id', organization_id)
      .eq('applications.organization_id', organization_id);

    if (relationshipsError) {
      throw new Error(`Failed to fetch relationships: ${relationshipsError.message}`);
    }

    console.log(`📊 Found ${currentRelationships?.length || 0} current user-app relationships`);

    // Step 5: Get actual user assignments from Microsoft AND analyze group assignments
    console.log(`🔍 Fetching actual user assignments from Microsoft and analyzing group assignments...`);
    
    const actualAssignments = new Map<string, Set<string>>(); // userEmail -> Set<appId>
    const groupBasedApps = new Map<string, Set<string>>(); // appId -> Set<userEmails from groups>
    
    // Get active member users for validation
    const includeGuests = false; // Only members
    const includeDisabled = false; // Only active members (exclude disabled)
    const activeMemberUsers = await correctMicrosoftService.getUsersList(includeGuests, includeDisabled);
    console.log(`👥 Found ${activeMemberUsers.length} active member users`);
    
    // Create a set of active member emails for quick lookup
    const activeMemberEmails = new Set(activeMemberUsers.map(u => (u.mail || u.userPrincipalName)?.toLowerCase()).filter(Boolean));
    
    // Step 5a: Analyze group assignments for apps to understand "All Users" pattern
    console.log(`🔍 Analyzing group assignments to identify apps with broad access...`);
    
    const servicePrincipals = await correctMicrosoftService.getAllPages('/servicePrincipals');
    console.log(`📊 Found ${servicePrincipals.length} service principals`);
    
    for (const sp of servicePrincipals) {
      if (!sp.appId || !sp.displayName) continue;
      
      try {
        // Get app role assignments for this service principal
        const appRoleAssignments = await correctMicrosoftService.client.api(`/servicePrincipals/${sp.id}/appRoleAssignedTo`).get();
        
        const groupAssignments = appRoleAssignments?.value?.filter((a: any) => a.principalType === 'Group') || [];
        
        if (groupAssignments.length > 0) {
          console.log(`📋 App ${sp.displayName} has ${groupAssignments.length} group assignments`);
          
          const appUserEmails = new Set<string>();
          
          for (const groupAssignment of groupAssignments) {
            try {
              // Get group members
              const groupMembers = await correctMicrosoftService.getAllPages(`/groups/${groupAssignment.principalId}/members`);
              
              // Filter to active members only
              for (const member of groupMembers || []) {
                const memberEmail = (member.mail || member.userPrincipalName)?.toLowerCase();
                if (memberEmail && activeMemberEmails.has(memberEmail)) {
                  appUserEmails.add(memberEmail);
                }
              }
              
              console.log(`   📊 Group ${groupAssignment.principalDisplayName}: ${groupMembers?.length || 0} total members, ${Array.from(appUserEmails).length} active members`);
              
            } catch (groupError) {
              console.warn(`⚠️ Could not fetch members for group ${groupAssignment.principalId}: ${groupError}`);
            }
          }
          
          if (appUserEmails.size > 0) {
            groupBasedApps.set(sp.appId, appUserEmails);
            console.log(`✅ App ${sp.displayName} (${sp.appId}) should have ${appUserEmails.size} users from group assignments`);
          }
        }
        
        // Small delay to avoid rate limiting
        await sleep(100);
        
      } catch (spError) {
        console.warn(`⚠️ Could not analyze service principal ${sp.displayName}: ${spError}`);
      }
    }
    
    // Step 5b: Get individual OAuth token assignments (optimized approach)
    console.log(`⚡ Getting OAuth token assignments for validation...`);
    
    try {
      // This method gets actual user-specific assignments
      const tokens = await correctMicrosoftService.getOAuthTokens(activeMemberUsers);
      console.log(`✅ Found ${tokens.length} user-app tokens from OAuth grants`);
      
      // Process tokens to build individual assignments map
      for (const token of tokens) {
        if (token.userEmail && token.clientId) {
          if (!actualAssignments.has(token.userEmail)) {
            actualAssignments.set(token.userEmail, new Set());
          }
          actualAssignments.get(token.userEmail)!.add(token.clientId);
        }
      }
      
    } catch (tokenError) {
      console.warn(`⚠️ OAuth token fetch failed: ${tokenError}`);
    }
    
    // Step 5c: Combine group-based and individual assignments
    console.log(`🔗 Combining group-based and individual assignments...`);
    
    for (const [appId, userEmails] of groupBasedApps.entries()) {
      for (const userEmail of userEmails) {
        if (!actualAssignments.has(userEmail)) {
          actualAssignments.set(userEmail, new Set());
        }
        actualAssignments.get(userEmail)!.add(appId);
      }
    }
    
    console.log(`✅ Final assignment map covers ${actualAssignments.size} users`);
    console.log(`📊 Group-based apps: ${Array.from(groupBasedApps.keys()).join(', ')}`);
    
    // Log sample of assignments for verification
    let sampleCount = 0;
    for (const [userEmail, appIds] of actualAssignments.entries()) {
      if (sampleCount < 5) {
        console.log(`   📝 Sample: ${userEmail} -> ${Array.from(appIds).join(', ')}`);
        sampleCount++;
      }
    }

    console.log(`✅ Found actual assignments for ${actualAssignments.size} users`);

    // Step 6: Compare and identify relationships to remove
    const relationshipsToRemove: any[] = [];
    const relationshipsToKeep: any[] = [];

    for (const relationship of currentRelationships || []) {
      const userEmail = (relationship.users as any).email;
      const appId = (relationship.applications as any).microsoft_app_id;
      const appName = (relationship.applications as any).name;

      const hasActualAssignment = actualAssignments.get(userEmail)?.has(appId) || false;

      if (hasActualAssignment) {
        relationshipsToKeep.push({
          ...relationship,
          userEmail,
          appName,
          appId
        });
      } else {
        relationshipsToRemove.push({
          ...relationship,
          userEmail,
          appName,
          appId
        });
      }
    }

    console.log(`📊 Analysis complete:`);
    console.log(`   ✅ Relationships to keep: ${relationshipsToKeep.length}`);
    console.log(`   ❌ Relationships to remove: ${relationshipsToRemove.length}`);

    // Step 7: Show detailed breakdown
    const appBreakdown = new Map<string, { keep: number, remove: number }>();
    
    for (const rel of relationshipsToKeep) {
      const appName = rel.appName;
      if (!appBreakdown.has(appName)) {
        appBreakdown.set(appName, { keep: 0, remove: 0 });
      }
      appBreakdown.get(appName)!.keep++;
    }

    for (const rel of relationshipsToRemove) {
      const appName = rel.appName;
      if (!appBreakdown.has(appName)) {
        appBreakdown.set(appName, { keep: 0, remove: 0 });
      }
      appBreakdown.get(appName)!.remove++;
    }

    console.log(`📊 Breakdown by application:`);
    for (const [appName, counts] of appBreakdown.entries()) {
      console.log(`   ${appName}: Keep ${counts.keep}, Remove ${counts.remove}`);
    }

    // Step 8: Remove incorrect relationships (if not dry run)
    let removedCount = 0;
    if (!dry_run && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} incorrect relationships...`);
      
      // Remove in batches to avoid overwhelming the database
      const batchSize = 50;
      for (let i = 0; i < relationshipsToRemove.length; i += batchSize) {
        const batch = relationshipsToRemove.slice(i, i + batchSize);
        const idsToRemove = batch.map(rel => rel.id);
        
        const { error: deleteError } = await supabaseAdmin
          .from('user_applications')
          .delete()
          .in('id', idsToRemove);

        if (deleteError) {
          console.error(`❌ Error removing batch ${i / batchSize + 1}:`, deleteError);
        } else {
          removedCount += batch.length;
          console.log(`✅ Removed batch ${i / batchSize + 1}/${Math.ceil(relationshipsToRemove.length / batchSize)} (${batch.length} relationships)`);
        }

        await sleep(200); // Small delay between batches
      }
    }

    // Step 9: Update application user counts
    if (!dry_run) {
      console.log(`🔄 Updating application user counts...`);
      
      const { data: applications } = await supabaseAdmin
        .from('applications')
        .select('id, name')
        .eq('organization_id', organization_id);

      if (applications) {
        for (const app of applications) {
          const { count } = await supabaseAdmin
            .from('user_applications')
            .select('*', { count: 'exact', head: true })
            .eq('application_id', app.id);

          await supabaseAdmin
            .from('applications')
            .update({ 
              user_count: count || 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', app.id);
        }
      }
    }

    const result = {
      organization: {
        id: organization_id,
        name: org.name,
        domain: org.domain
      },
      analysis: {
        totalRelationships: currentRelationships?.length || 0,
        relationshipsToKeep: relationshipsToKeep.length,
        relationshipsToRemove: relationshipsToRemove.length,
        actualAssignments: actualAssignments.size
      },
      applicationBreakdown: Object.fromEntries(appBreakdown),
      actions: {
        dryRun: dry_run,
        removedRelationships: removedCount
      },
      details: {
        relationshipsToRemove: relationshipsToRemove.map(rel => ({
          userEmail: rel.userEmail,
          appName: rel.appName,
          appId: rel.appId
        }))
      }
    };

    console.log(`🎉 Cleanup ${dry_run ? 'analysis' : 'execution'} completed successfully`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return NextResponse.json({ 
      error: 'Cleanup failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
