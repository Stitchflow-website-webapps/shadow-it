import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
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
  suspendedUsers: number;
  archivedUsers: number;
  hardDeletedUsers: number;
  retryCount: number;
  details: {
    removedUserEmails: string[];
    removedApplicationNames: string[];
    relationshipsByApp: Record<string, number>;
    suspendedUserEmails: string[];
    archivedUserEmails: string[];
    hardDeletedUserEmails: string[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const { dry_run = true, organization_id } = await request.json();
    
    console.log(`🧹 Starting Google Suspended/Archived Users Cleanup`);
    console.log(`🔍 Mode: ${dry_run ? 'DRY RUN (no changes)' : 'LIVE (will make changes)'}`);
    
    // Get all Google organizations or specific org
    let organizations;
    if (organization_id) {
      console.log(`🎯 Processing specific organization: ${organization_id}`);
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('id', organization_id)
        .eq('auth_provider', 'google')
        .single();
        
      if (orgError || !org) {
        return NextResponse.json({ error: 'Google organization not found' }, { status: 404 });
      }
      organizations = [org];
    } else {
      console.log(`🌍 Processing ALL Google organizations`);
      const { data: orgs, error: orgsError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('auth_provider', 'google');
        
      if (orgsError) {
        throw new Error(`Failed to fetch organizations: ${orgsError.message}`);
      }
      organizations = orgs || [];
    }
    
    console.log(`📊 Found ${organizations.length} Google organizations to process`);
    
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
      totalSuspendedUsers: results.reduce((sum, r) => sum + r.suspendedUsers, 0),
      totalArchivedUsers: results.reduce((sum, r) => sum + r.archivedUsers, 0),
      totalHardDeletedUsers: results.reduce((sum, r) => sum + r.hardDeletedUsers, 0)
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
    suspendedUsers: 0,
    archivedUsers: 0,
    hardDeletedUsers: 0,
    retryCount: maxRetries,
    details: {
      removedUserEmails: [],
      removedApplicationNames: [],
      relationshipsByApp: {},
      suspendedUserEmails: [],
      archivedUserEmails: [],
      hardDeletedUserEmails: []
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
    suspendedUsers: 0,
    archivedUsers: 0,
    hardDeletedUsers: 0,
    retryCount: 0,
    details: {
      removedUserEmails: [],
      removedApplicationNames: [],
      relationshipsByApp: {},
      suspendedUserEmails: [],
      archivedUserEmails: [],
      hardDeletedUserEmails: []
    }
  };
  
  try {
    // Step 1: Get Google credentials for this organization
    const { data: syncRecord, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('*')
      .eq('organization_id', org.id)
      .eq('provider', 'google')
      .not('refresh_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (syncError || !syncRecord) {
      throw new Error(`No Google sync credentials found for organization ${org.name}`);
    }

    console.log(`✅ Found Google sync credentials for ${org.name}`);

    // Step 2: Initialize Google service
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({
      refresh_token: syncRecord.refresh_token
    });

    // Refresh tokens
    const refreshedTokens = await googleService.refreshAccessToken(true);
    if (!refreshedTokens?.access_token) {
      throw new Error("Could not refresh Google tokens");
    }

    console.log(`✅ Google service initialized for ${org.name}`);

    // Step 3: Fetch ALL users from Google (including suspended and archived)
    console.log(`🔍 Fetching ALL users from Google Workspace to detect hard-deleted, suspended, and archived users...`);
    
    // Get ALL users from Google (including suspended and archived)
    const allGoogleUsers = await googleService.getUsersListPaginated(true, true);
    const allGoogleEmails = new Set(
      allGoogleUsers
        .map(u => u.primaryEmail?.toLowerCase())
        .filter(Boolean) as string[]
    );
    
    console.log(`📊 Found ${allGoogleUsers.length} total users in Google Workspace`);

    // Step 4: Get all users for this org from our database
    console.log(`🔍 Fetching all users for ${org.name} from database...`);
    
    const { data: allDbUsers, error: allUsersError } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('organization_id', org.id);

    if (allUsersError) {
      throw new Error(`Failed to fetch users from database: ${allUsersError.message}`);
    }

    if (!allDbUsers || allDbUsers.length === 0) {
      console.log(`✅ No users found in database for ${org.name} - nothing to clean up`);
      result.success = true;
      return result;
    }

    console.log(`📊 Found ${allDbUsers.length} users in database for ${org.name}`);

    // Step 5: Identify different types of users to remove
    const usersToRemove = [];
    const suspendedUserEmails: string[] = [];
    const archivedUserEmails: string[] = [];
    const hardDeletedUserEmails: string[] = [];

    // Check each database user
    for (const dbUser of allDbUsers) {
      const userEmail = dbUser.email.toLowerCase();
      
      if (!allGoogleEmails.has(userEmail)) {
        // User exists in DB but not in Google = hard-deleted
        usersToRemove.push(dbUser);
        hardDeletedUserEmails.push(dbUser.email);
      } else {
        // User exists in both, check if suspended or archived
        const googleUser = allGoogleUsers.find(gu => gu.primaryEmail?.toLowerCase() === userEmail);
        if (googleUser) {
          if (googleUser.suspended === true) {
            usersToRemove.push(dbUser);
            suspendedUserEmails.push(dbUser.email);
          } else if (googleUser.archived === true) {
            usersToRemove.push(dbUser);
            archivedUserEmails.push(dbUser.email);
          }
        }
      }
    }

    // Update result counts
    result.suspendedUsers = suspendedUserEmails.length;
    result.archivedUsers = archivedUserEmails.length;
    result.hardDeletedUsers = hardDeletedUserEmails.length;
    
    // Update result details
    result.details.suspendedUserEmails = suspendedUserEmails;
    result.details.archivedUserEmails = archivedUserEmails;
    result.details.hardDeletedUserEmails = hardDeletedUserEmails;
    result.details.removedUserEmails = usersToRemove.map(u => u.email);
    
    console.log(`📊 Found users to remove:`);
    console.log(`   🚫 ${hardDeletedUserEmails.length} hard-deleted users: ${hardDeletedUserEmails.join(', ')}`);
    console.log(`   ⏸️  ${suspendedUserEmails.length} suspended users: ${suspendedUserEmails.join(', ')}`);
    console.log(`   📦 ${archivedUserEmails.length} archived users: ${archivedUserEmails.join(', ')}`);
    
    if (usersToRemove.length === 0) {
      console.log(`✅ No users to remove for ${org.name} - all users are active in Google`);
      result.success = true;
      return result;
    }

    // Step 6: Get user-application relationships for these users
    const userIds = usersToRemove.map(u => u.id);
    
    const { data: relationshipsToRemove, error: relationshipsError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        id,
        application_id,
        applications!inner(id, name)
      `)
      .in('user_id', userIds);

    if (relationshipsError) {
      throw new Error(`Failed to fetch user relationships: ${relationshipsError.message}`);
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

    // Step 7: Remove user-application relationships (if not dry run)
    if (!dry_run && relationshipsToRemove && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} user-application relationships...`);
      
      const relationshipIds = relationshipsToRemove.map(r => r.id);
      const { error: deleteRelError } = await supabaseAdmin
        .from('user_applications')
        .delete()
        .in('id', relationshipIds);

      if (deleteRelError) {
        throw new Error(`Failed to remove user relationships: ${deleteRelError.message}`);
      }
      
      result.removedRelationships = relationshipsToRemove.length;
      
      // Track relationships by app for logging
      for (const [appId, appInfo] of affectedApplications.entries()) {
        result.details.relationshipsByApp[appInfo.name] = appInfo.relationshipsToRemove;
      }
    }

    // Step 8: Remove users (if not dry run)
    if (!dry_run) {
      console.log(`🗑️ Removing ${usersToRemove.length} users (hard-deleted/suspended/archived)...`);
      
      const { error: deleteUsersError } = await supabaseAdmin
        .from('users')
        .delete()
        .in('id', userIds);

      if (deleteUsersError) {
        throw new Error(`Failed to remove users: ${deleteUsersError.message}`);
      }
      
      result.removedUsers = usersToRemove.length;
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
    console.log(`   👥 Users: ${result.removedUsers} removed (${result.hardDeletedUsers} hard-deleted, ${result.suspendedUsers} suspended, ${result.archivedUsers} archived)`);
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
