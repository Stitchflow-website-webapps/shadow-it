import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

export const maxDuration = 1800; // 30 minutes timeout
export const dynamic = 'force-dynamic';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  try {
    const { organization_id, dry_run = true, cleanup_users_table = false } = await request.json();
    
    if (!organization_id) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    console.log(`🧹 Starting COMPREHENSIVE Microsoft cleanup for organization: ${organization_id}`);
    console.log(`🔍 Mode: ${dry_run ? 'DRY RUN (no changes)' : 'LIVE (will make changes)'}`);
    console.log(`👥 Users table cleanup: ${cleanup_users_table ? 'ENABLED' : 'DISABLED'}`);

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

    // Step 2: Get Microsoft credentials and initialize service
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

    console.log(`✅ Microsoft service initialized for tenant: ${tenantId}`);

    // Step 3: Users table cleanup (if requested)
    let usersCleanupResult = null;
    if (cleanup_users_table) {
      console.log(`👥 Starting users table cleanup...`);
      
      // Get all users for this organization
      const { data: allUsers, error: usersError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('organization_id', organization_id);

      if (usersError) {
        throw new Error(`Failed to fetch users: ${usersError.message}`);
      }

      console.log(`📊 Found ${allUsers?.length || 0} total users in database`);

      // Get active member users from Microsoft (this will be our filter)
      const activeMemberUsers = await correctMicrosoftService.getUsersList(false, false); // Only active members
      const activeMemberEmails = new Set(
        activeMemberUsers.map(u => (u.mail || u.userPrincipalName)?.toLowerCase()).filter(Boolean)
      );

      console.log(`📊 Found ${activeMemberUsers.length} active members in Microsoft`);

      // Identify users to remove (not in active members list)
      const usersToRemove = (allUsers || []).filter(user => 
        user.email && !activeMemberEmails.has(user.email.toLowerCase())
      );

      console.log(`🗑️ Found ${usersToRemove.length} users to remove from database (guests + disabled)`);

      usersCleanupResult = {
        totalUsers: allUsers?.length || 0,
        activeMembersInMicrosoft: activeMemberUsers.length,
        usersToRemove: usersToRemove.length,
        removedUsers: 0
      };

      // Remove users (if not dry run)
      if (!dry_run && usersToRemove.length > 0) {
        console.log(`🗑️ Removing ${usersToRemove.length} users from database...`);
        
        // Remove in batches
        const batchSize = 50;
        for (let i = 0; i < usersToRemove.length; i += batchSize) {
          const batch = usersToRemove.slice(i, i + batchSize);
          const idsToRemove = batch.map(user => user.id);
          
          const { error: deleteError } = await supabaseAdmin
            .from('users')
            .delete()
            .in('id', idsToRemove);

          if (deleteError) {
            console.error(`❌ Error removing user batch ${i / batchSize + 1}:`, deleteError);
          } else {
            usersCleanupResult.removedUsers += batch.length;
            console.log(`✅ Removed user batch ${i / batchSize + 1}/${Math.ceil(usersToRemove.length / batchSize)} (${batch.length} users)`);
          }

          await sleep(200);
        }
      }
    }

    // Step 4: Get current user-app relationships from database
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

    // Step 5: Get ACTUAL user assignments from Microsoft using a corrected approach
    console.log(`🔍 Fetching ACTUAL user assignments from Microsoft...`);
    
    const actualAssignments = new Map<string, Set<string>>(); // userEmail -> Set<appId>
    
    // Get only active members for processing
    const activeMemberUsers = await correctMicrosoftService.getUsersList(false, false);
    console.log(`👥 Processing ${activeMemberUsers.length} active member users...`);

    // Process each user individually to get their ACTUAL app assignments
    // This bypasses the problematic getOAuthTokens method
    const batchSize = 10;
    const batchDelay = 1000;
    
    for (let i = 0; i < activeMemberUsers.length; i += batchSize) {
      const userBatch = activeMemberUsers.slice(i, i + batchSize);
      console.log(`📈 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(activeMemberUsers.length/batchSize)} (${userBatch.length} users)...`);
      
      for (const user of userBatch) {
        const userEmail = user.mail || user.userPrincipalName;
        if (!userEmail) continue;

        try {
          // Get ONLY app role assignments (direct assignments)
          const appRoleResponse = await correctMicrosoftService.client.api(`/users/${user.id}/appRoleAssignments`).get();
          
          if (appRoleResponse?.value) {
            for (const assignment of appRoleResponse.value) {
              if (assignment.resourceId) {
                try {
                  const spResponse = await correctMicrosoftService.client.api(`/servicePrincipals/${assignment.resourceId}`).get();
                  if (spResponse?.appId) {
                    if (!actualAssignments.has(userEmail)) {
                      actualAssignments.set(userEmail, new Set());
                    }
                    actualAssignments.get(userEmail)!.add(spResponse.appId);
                  }
                } catch (spError) {
                  console.warn(`⚠️ Could not find service principal ${assignment.resourceId}`);
                }
              }
            }
          }
          
          await sleep(100); // Small delay between users
        } catch (error) {
          console.warn(`⚠️ Error processing user ${userEmail}: ${error}`);
        }
      }
      
      // Delay between batches
      if (i + batchSize < activeMemberUsers.length) {
        console.log(`⏳ Waiting ${batchDelay/1000}s before next batch...`);
        await sleep(batchDelay);
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

    console.log(`📊 User-App Relationship Analysis:`);
    console.log(`   ✅ Relationships to keep: ${relationshipsToKeep.length}`);
    console.log(`   ❌ Relationships to remove: ${relationshipsToRemove.length}`);

    // Step 7: Show detailed breakdown by application
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
    let removedRelationshipsCount = 0;
    if (!dry_run && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} incorrect relationships...`);
      
      const batchSize = 50;
      for (let i = 0; i < relationshipsToRemove.length; i += batchSize) {
        const batch = relationshipsToRemove.slice(i, i + batchSize);
        const idsToRemove = batch.map(rel => rel.id);
        
        const { error: deleteError } = await supabaseAdmin
          .from('user_applications')
          .delete()
          .in('id', idsToRemove);

        if (deleteError) {
          console.error(`❌ Error removing relationship batch ${i / batchSize + 1}:`, deleteError);
        } else {
          removedRelationshipsCount += batch.length;
          console.log(`✅ Removed relationship batch ${i / batchSize + 1}/${Math.ceil(relationshipsToRemove.length / batchSize)} (${batch.length} relationships)`);
        }

        await sleep(200);
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
      usersTableCleanup: usersCleanupResult,
      relationshipsAnalysis: {
        totalRelationships: currentRelationships?.length || 0,
        relationshipsToKeep: relationshipsToKeep.length,
        relationshipsToRemove: relationshipsToRemove.length,
        actualAssignments: actualAssignments.size
      },
      applicationBreakdown: Object.fromEntries(appBreakdown),
      actions: {
        dryRun: dry_run,
        removedUsers: usersCleanupResult?.removedUsers || 0,
        removedRelationships: removedRelationshipsCount
      },
      details: {
        relationshipsToRemove: relationshipsToRemove.slice(0, 50).map(rel => ({ // Limit to first 50 for response size
          userEmail: rel.userEmail,
          appName: rel.appName,
          appId: rel.appId
        }))
      }
    };

    console.log(`🎉 Comprehensive cleanup ${dry_run ? 'analysis' : 'execution'} completed successfully`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Comprehensive cleanup error:', error);
    return NextResponse.json({ 
      error: 'Comprehensive cleanup failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
