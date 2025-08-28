import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';
import { determineRiskLevel } from '@/lib/risk-assessment';

export const maxDuration = 3600; // 1 hour timeout for processing multiple orgs
export const dynamic = 'force-dynamic';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface CleanupResult {
  organizationId: string;
  organizationName: string;
  organizationDomain: string;
  success: boolean;
  error?: string;
  removedUsers: number;
  removedRelationships: number;
  removedApplications: number;
  guestUsers: number;
  disabledUsers: number;
  orphanedUsers: number; // Users in DB but not in current active member list
  retryCount: number;
  details: {
    removedUserEmails: string[];
    removedApplicationNames: string[];
    relationshipsByApp: Record<string, number>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { dry_run = true, organization_id } = await request.json();
    
    console.log(`🧹 Starting Guest/Disabled Users Cleanup`);
    console.log(`🔍 Mode: ${dry_run ? 'DRY RUN (no changes)' : 'LIVE (will make changes)'}`);
    
    // Get all Microsoft organizations or specific org
    let organizations;
    if (organization_id) {
      console.log(`🎯 Processing specific organization: ${organization_id}`);
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('id', organization_id)
        .eq('auth_provider', 'microsoft')
        .single();
        
      if (orgError || !org) {
        return NextResponse.json({ error: 'Microsoft organization not found' }, { status: 404 });
      }
      organizations = [org];
    } else {
      console.log(`🌍 Processing ALL Microsoft organizations`);
      const { data: orgs, error: orgsError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('auth_provider', 'microsoft');
        
      if (orgsError) {
        throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
      }
      organizations = orgs || [];
    }
    
    console.log(`📊 Found ${organizations.length} Microsoft organizations to process`);
    
    const results: CleanupResult[] = [];
    
    // Process each organization with delay
    for (let i = 0; i < organizations.length; i++) {
      const org = organizations[i];
      console.log(`\n🏢 Processing organization ${i + 1}/${organizations.length}: ${org.name} (${org.domain})`);
      
      const result = await processOrganizationWithRetry(org, dry_run);
      results.push(result);
      
      // Add delay between organizations (except for the last one)
      if (i < organizations.length - 1) {
        console.log(`⏳ Waiting 1 minute before processing next organization...`);
        await sleep(60000); // 1 minute delay
      }
    }
    
    // Generate summary
    const summary = {
      totalOrganizations: organizations.length,
      successfulOrganizations: results.filter(r => r.success).length,
      failedOrganizations: results.filter(r => !r.success).length,
      totalRemovedUsers: results.reduce((sum, r) => sum + r.removedUsers, 0),
      totalRemovedRelationships: results.reduce((sum, r) => sum + r.removedRelationships, 0),
      totalRemovedApplications: results.reduce((sum, r) => sum + r.removedApplications, 0),
      totalGuestUsers: results.reduce((sum, r) => sum + r.guestUsers, 0),
      totalDisabledUsers: results.reduce((sum, r) => sum + r.disabledUsers, 0),
      totalUsersNotInActiveMemberList: results.reduce((sum, r) => sum + r.orphanedUsers, 0)
    };
    
    console.log(`\n🎉 Cleanup completed!`);
    console.log(`📊 Summary: ${summary.successfulOrganizations}/${summary.totalOrganizations} orgs successful`);
    console.log(`👥 Removed: ${summary.totalRemovedUsers} users, ${summary.totalRemovedRelationships} relationships, ${summary.totalRemovedApplications} apps`);
    
    return NextResponse.json({
      success: true,
      dryRun: dry_run,
      summary,
      results
    });
    
  } catch (error) {
    console.error('❌ Cleanup process failed:', error);
    return NextResponse.json({ 
      error: 'Cleanup process failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}

async function processOrganizationWithRetry(org: any, dry_run: boolean, maxRetries: number = 2): Promise<CleanupResult> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`🔄 Retry attempt ${attempt}/${maxRetries} for organization: ${org.name}`);
        await sleep(5000); // 5 second delay before retry
      }
      
      const result = await processOrganization(org, dry_run);
      result.retryCount = attempt;
      return result;
      
    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt + 1} failed for ${org.name}:`, error);
      
      if (attempt === maxRetries) {
        console.error(`💥 All retry attempts exhausted for ${org.name}`);
        break;
      }
    }
  }
  
  // Return failure result
  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationDomain: org.domain,
    success: false,
    error: lastError?.message || 'Unknown error',
    removedUsers: 0,
    removedRelationships: 0,
    removedApplications: 0,
    guestUsers: 0,
    disabledUsers: 0,
    orphanedUsers: 0,
    retryCount: maxRetries,
    details: {
      removedUserEmails: [],
      removedApplicationNames: [],
      relationshipsByApp: {}
    }
  };
}

async function processOrganization(org: any, dry_run: boolean): Promise<CleanupResult> {
  const result: CleanupResult = {
    organizationId: org.id,
    organizationName: org.name,
    organizationDomain: org.domain,
    success: false,
    removedUsers: 0,
    removedRelationships: 0,
    removedApplications: 0,
    guestUsers: 0,
    disabledUsers: 0,
    orphanedUsers: 0,
    retryCount: 0,
    details: {
      removedUserEmails: [],
      removedApplicationNames: [],
      relationshipsByApp: {}
    }
  };
  
  try {
    // Step 1: Get Microsoft credentials for this organization
    const { data: syncRecord, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', org.id)
      .eq('provider', 'microsoft')
      .not('refresh_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (syncError || !syncRecord) {
      throw new Error(`No Microsoft sync credentials found for organization ${org.name}`);
    }

    console.log(`✅ Found Microsoft sync credentials for ${org.name}`);

    // Step 2: Initialize Microsoft service
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
    console.log(`✅ Microsoft service initialized for ${org.name} (tenant: ${tenantId})`);

    // Step 3: Fetch ALL users from Microsoft and identify current active members
    console.log(`🔍 Fetching all users from Microsoft to identify current state...`);
    
    // Get ALL users from Microsoft (guests, disabled, and enabled members)
    const allMicrosoftUsers = await correctMicrosoftService.getUsersList(true, true); // Include guests and disabled
    
    // Filter for different user types
    const activeMemberUsers = allMicrosoftUsers.filter(user => 
      user.userType === 'Member' && user.accountEnabled === true
    );
    const guestUsers = allMicrosoftUsers.filter(u => u.userType === 'Guest');
    const disabledUsers = allMicrosoftUsers.filter(u => u.accountEnabled === false);
    
    result.guestUsers = guestUsers.length;
    result.disabledUsers = disabledUsers.length;
    
    console.log(`📊 Microsoft user breakdown:`);
    console.log(`   - Active Members (Member + Enabled): ${activeMemberUsers.length}`);
    console.log(`   - Guest Users: ${guestUsers.length}`);
    console.log(`   - Disabled Users: ${disabledUsers.length}`);
    console.log(`   - Total: ${allMicrosoftUsers.length}`);
    
    // Create sets for different user types
    const activeMemberEmails = new Set(
      activeMemberUsers
        .map(u => (u.mail || u.userPrincipalName)?.toLowerCase())
        .filter(Boolean)
    );
    
    const allMicrosoftUserEmails = new Set(
      allMicrosoftUsers
        .map(u => (u.mail || u.userPrincipalName)?.toLowerCase())
        .filter(Boolean)
    );
    
    console.log(`📊 Active member emails in Microsoft: ${activeMemberEmails.size}`);
    
    // Step 4: Find users in database that are not current active members in Microsoft
    console.log(`🔍 Checking database users against current active Microsoft members...`);
    
    const { data: allDatabaseUsers, error: allUsersError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, microsoft_user_id')
      .eq('organization_id', org.id)
      .not('microsoft_user_id', 'is', null); // Only check users that came from Microsoft
    
    if (allUsersError) {
      throw new Error(`Failed to fetch database users: ${allUsersError.message}`);
    }
    
    console.log(`📊 Found ${allDatabaseUsers?.length || 0} Microsoft users in database`);
    
    // Find users in database that are NOT in the current active member list
    const usersNotInActiveMemberList = (allDatabaseUsers || []).filter(dbUser => 
      dbUser.email && !activeMemberEmails.has(dbUser.email.toLowerCase())
    );
    
    // Also find completely orphaned users (not in Microsoft at all)
    const completelyOrphanedUsers = (allDatabaseUsers || []).filter(dbUser => 
      dbUser.email && !allMicrosoftUserEmails.has(dbUser.email.toLowerCase())
    );
    
    console.log(`📊 Database vs Microsoft analysis:`);
    console.log(`   - Users in DB: ${allDatabaseUsers?.length || 0}`);
    console.log(`   - Active members in Microsoft: ${activeMemberEmails.size}`);
    console.log(`   - Users in DB but not active members: ${usersNotInActiveMemberList.length}`);
    console.log(`   - Users completely missing from Microsoft: ${completelyOrphanedUsers.length}`);
    
    result.orphanedUsers = usersNotInActiveMemberList.length;
    
    // Step 5: Determine which users to remove (users not in active member list)
    if (usersNotInActiveMemberList.length === 0) {
      console.log(`✅ All database users are current active members in Microsoft - nothing to clean up`);
      result.success = true;
      return result;
    }

    console.log(`📊 Found ${usersNotInActiveMemberList.length} users in database to remove (not in active member list)`);
    
    // Safety check: If we're about to remove more than 90% of users, something might be wrong
    const totalDbUsers = allDatabaseUsers?.length || 0;
    const removalPercentage = totalDbUsers > 0 ? (usersNotInActiveMemberList.length / totalDbUsers) * 100 : 0;
    
    if (removalPercentage > 90) {
      console.warn(`⚠️ WARNING: About to remove ${removalPercentage.toFixed(1)}% of users (${usersNotInActiveMemberList.length}/${totalDbUsers})`);
      console.warn(`⚠️ This seems unusually high. Please verify the Microsoft API is returning correct data.`);
      
      if (!dry_run) {
        throw new Error(`Safety check failed: Attempting to remove ${removalPercentage.toFixed(1)}% of users. Run in dry_run mode first to verify.`);
      }
    }
    
    if (usersNotInActiveMemberList.length > 0) {
      // Only log first 10 users to avoid overwhelming the logs
      const usersToLog = usersNotInActiveMemberList.slice(0, 10);
      console.log(`🔍 Users in DB but not in active member list (showing first ${usersToLog.length}):`, 
        usersToLog.map(u => ({ email: u.email, name: u.name })));
      
      if (usersNotInActiveMemberList.length > 10) {
        console.log(`... and ${usersNotInActiveMemberList.length - 10} more users`);
      }
    }
    
    // Use the users that are not in the active member list
    const uniqueUsersToRemove = usersNotInActiveMemberList;
    result.details.removedUserEmails = uniqueUsersToRemove.map(u => u.email);

    // Step 6: Get user-application relationships for these users (in batches to avoid query limits)
    const userIds = uniqueUsersToRemove.map(u => u.id);
    
    console.log(`🔍 Fetching relationships for ${userIds.length} users...`);
    
    let relationshipsToRemove: any[] = [];
    const batchSize = 100; // Process users in batches of 100
    
    try {
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        console.log(`🔍 Processing relationship batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(userIds.length / batchSize)} (${batch.length} users)`);
        
        const { data: batchRelationships, error: batchError } = await supabaseAdmin
          .from('user_applications')
          .select(`
            id,
            application_id,
            applications!inner(id, name)
          `)
          .in('user_id', batch);

        if (batchError) {
          console.error(`❌ Error fetching relationships for batch ${Math.floor(i / batchSize) + 1}:`, batchError);
          throw new Error(`Failed to fetch user relationships for batch: ${batchError.message}`);
        }
        
        if (batchRelationships) {
          relationshipsToRemove.push(...batchRelationships);
        }
        
        // Small delay between batches to avoid overwhelming the database
        if (i + batchSize < userIds.length) {
          await sleep(100); // 100ms delay between batches
        }
      }
      
      console.log(`✅ Successfully fetched all relationships in ${Math.ceil(userIds.length / batchSize)} batches`);
      
    } catch (relationshipsError) {
      console.error(`❌ Error during relationship fetching:`, relationshipsError);
      throw new Error(`Failed to fetch user relationships: ${(relationshipsError as Error).message}`);
    }

    console.log(`📊 Found ${relationshipsToRemove?.length || 0} user-application relationships to remove`);

    // Track applications that will be affected
    const affectedApplications = new Map<string, { id: string, name: string, relationshipsToRemove: number }>();
    
    for (const rel of relationshipsToRemove || []) {
      const app = (rel.applications as any);
      if (!affectedApplications.has(app.id)) {
        affectedApplications.set(app.id, {
          id: app.id,
          name: app.name,
          relationshipsToRemove: 0
        });
      }
      affectedApplications.get(app.id)!.relationshipsToRemove++;
    }

    // Step 7: Remove user-application relationships (if not dry run) - in batches to avoid query limits
    if (!dry_run && relationshipsToRemove && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} user-application relationships...`);
      
      const relationshipIds = relationshipsToRemove.map(r => r.id);
      let totalRemovedRelationships = 0;
      const relationshipDeletionBatchSize = 100; // Batch size for relationship deletions
      
      try {
        for (let i = 0; i < relationshipIds.length; i += relationshipDeletionBatchSize) {
          const batch = relationshipIds.slice(i, i + relationshipDeletionBatchSize);
          console.log(`🗑️ Deleting relationship batch ${Math.floor(i / relationshipDeletionBatchSize) + 1}/${Math.ceil(relationshipIds.length / relationshipDeletionBatchSize)} (${batch.length} relationships)`);
          
          const { error: deleteRelError } = await supabaseAdmin
            .from('user_applications')
            .delete()
            .in('id', batch);

          if (deleteRelError) {
            console.error(`❌ Error deleting relationship batch ${Math.floor(i / relationshipDeletionBatchSize) + 1}:`, deleteRelError);
            throw new Error(`Failed to remove user relationships in batch: ${deleteRelError.message}`);
          }
          
          totalRemovedRelationships += batch.length;
          console.log(`✅ Deleted ${batch.length} relationships, total so far: ${totalRemovedRelationships}`);
          
          // Small delay between relationship deletion batches
          if (i + relationshipDeletionBatchSize < relationshipIds.length) {
            await sleep(100); // 100ms delay between relationship deletion batches
          }
        }
        
        result.removedRelationships = totalRemovedRelationships;
        console.log(`✅ Successfully removed all ${totalRemovedRelationships} relationships in ${Math.ceil(relationshipIds.length / relationshipDeletionBatchSize)} batches`);
        
        // Track relationships by app for logging
        for (const [appId, appInfo] of affectedApplications.entries()) {
          result.details.relationshipsByApp[appInfo.name] = appInfo.relationshipsToRemove;
        }
        
      } catch (relationshipDeletionError) {
        console.error(`❌ Error during relationship deletion:`, relationshipDeletionError);
        throw new Error(`Failed to remove user relationships: ${(relationshipDeletionError as Error).message}`);
      }
    }

    // Step 8: Remove users (if not dry run) - in batches to avoid query limits
    if (!dry_run) {
      console.log(`🗑️ Removing ${uniqueUsersToRemove.length} users (not in active member list)...`);
      
      let totalRemovedUsers = 0;
      const userDeletionBatchSize = 50; // Smaller batch size for deletions
      
      try {
        for (let i = 0; i < userIds.length; i += userDeletionBatchSize) {
          const batch = userIds.slice(i, i + userDeletionBatchSize);
          console.log(`🗑️ Deleting user batch ${Math.floor(i / userDeletionBatchSize) + 1}/${Math.ceil(userIds.length / userDeletionBatchSize)} (${batch.length} users)`);
          
          const { error: deleteUsersError } = await supabaseAdmin
            .from('users')
            .delete()
            .in('id', batch);

          if (deleteUsersError) {
            console.error(`❌ Error deleting user batch ${Math.floor(i / userDeletionBatchSize) + 1}:`, deleteUsersError);
            throw new Error(`Failed to remove users in batch: ${deleteUsersError.message}`);
          }
          
          totalRemovedUsers += batch.length;
          console.log(`✅ Deleted ${batch.length} users, total so far: ${totalRemovedUsers}`);
          
          // Small delay between deletion batches
          if (i + userDeletionBatchSize < userIds.length) {
            await sleep(200); // 200ms delay between deletion batches
          }
        }
        
        result.removedUsers = totalRemovedUsers;
        console.log(`✅ Successfully removed all ${totalRemovedUsers} users in ${Math.ceil(userIds.length / userDeletionBatchSize)} batches`);
        
      } catch (userDeletionError) {
        console.error(`❌ Error during user deletion:`, userDeletionError);
        throw new Error(`Failed to remove users: ${(userDeletionError as Error).message}`);
      }
    }

    // Step 9: Check for applications that became empty and remove them
    const applicationsToRemove: string[] = [];
    
    for (const [appId, appInfo] of affectedApplications.entries()) {
      // Check if this application now has zero users
      const { count } = await supabaseAdmin
        .from('user_applications')
        .select('*', { count: 'exact', head: true })
        .eq('application_id', appId);
      
      if (count === 0) {
        applicationsToRemove.push(appId);
        result.details.removedApplicationNames.push(appInfo.name);
        console.log(`📱 Application "${appInfo.name}" now has zero users and will be removed`);
      }
    }

    // Step 10: Remove empty applications (if not dry run)
    if (!dry_run && applicationsToRemove.length > 0) {
      console.log(`🗑️ Removing ${applicationsToRemove.length} empty applications...`);
      
      const { error: deleteAppsError } = await supabaseAdmin
        .from('applications')
        .delete()
        .in('id', applicationsToRemove);

      if (deleteAppsError) {
        throw new Error(`Failed to remove empty applications: ${deleteAppsError.message}`);
      }
      
      result.removedApplications = applicationsToRemove.length;
    }

    // Step 11: Recalculate application risk levels after user removal
    if (!dry_run && (result.removedUsers > 0 || result.removedRelationships > 0)) {
      console.log(`🔄 Recalculating application risk levels after user removal...`);
      
      try {
        await recalculateApplicationRiskLevels(org.id);
        console.log(`✅ Application risk levels recalculated successfully`);
      } catch (riskError) {
        console.error(`⚠️ Warning: Failed to recalculate risk levels:`, riskError);
        // Don't fail the entire cleanup for risk calculation errors
      }
    }

    console.log(`✅ Cleanup completed for ${org.name}:`);
    console.log(`   👥 Users: ${result.removedUsers} removed (users not in active member list)`);
    console.log(`   📊 Microsoft active members: ${activeMemberUsers.length}`);
    console.log(`   📊 Microsoft stats: ${result.guestUsers} guests, ${result.disabledUsers} disabled`);
    console.log(`   🔗 Relationships: ${result.removedRelationships} removed`);
    console.log(`   📱 Applications: ${result.removedApplications} removed`);

    result.success = true;
    return result;

  } catch (error) {
    console.error(`❌ Error processing organization ${org.name}:`, error);
    result.error = (error as Error).message;
    throw error;
  }
}

// Helper function to recalculate application risk levels
async function recalculateApplicationRiskLevels(orgId: string) {
  // Get all applications with their user_applications and scopes
  const { data: applications, error: fetchError } = await supabaseAdmin
    .from('applications')
    .select(`
      id,
      name,
      all_scopes,
      user_applications!inner (
        scopes,
        user:users!inner (
          id
        )
      )
    `)
    .eq('organization_id', orgId);

  if (fetchError) {
    throw fetchError;
  }

  if (!applications || applications.length === 0) {
    console.log('No applications found to recalculate risk levels');
    return;
  }

  console.log(`Recalculating risk levels for ${applications.length} applications`);

  // Process each application
  for (const app of applications) {
    try {
      // Collect all scopes from user_applications for this app
      const allUserScopes = new Set<string>();
      
      if (app.user_applications && Array.isArray(app.user_applications)) {
        app.user_applications.forEach((ua: any) => {
          if (ua.scopes && Array.isArray(ua.scopes)) {
            ua.scopes.forEach((scope: string) => allUserScopes.add(scope));
          }
        });
      }

      // Risk assessment based on ACTUAL user permissions only
      const userScopes = Array.from(allUserScopes);
      
      // Keep all_scopes for reference but use user scopes for risk calculation
      const allAppScopes = new Set<string>(allUserScopes);
      if (app.all_scopes && Array.isArray(app.all_scopes)) {
        app.all_scopes.forEach((scope: string) => allAppScopes.add(scope));
      }
      
      // Recalculate risk level based on user scopes
      const newRiskLevel = determineRiskLevel(userScopes);
      const normalizedRiskLevel = newRiskLevel.toUpperCase();
      
      // Update the application with correct risk level and scope count
      const { error: updateError } = await supabaseAdmin
        .from('applications')
        .update({
          risk_level: normalizedRiskLevel,
          total_permissions: userScopes.length, // User scope count for risk calculation
          all_scopes: Array.from(allAppScopes), // Preserve all application scopes for reference
          updated_at: new Date().toISOString()
        })
        .eq('id', app.id);

      if (updateError) {
        console.error(`Error updating app ${app.name} (${app.id}):`, updateError);
        continue;
      }

      console.log(`📊 Updated ${app.name}: ${newRiskLevel} risk (${userScopes.length} user scopes)`);

    } catch (error) {
      console.error(`Error processing app ${app.name}:`, error);
      continue;
    }
  }
}
