import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client';
import { determineRiskLevel, determineRiskReason, transformRiskLevel, determineAppRiskReason } from '@/lib/risk-assessment';

// Define types for the database responses
type UserType = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  created_at: string;
  // last_login: string | null; // Removed
}

type UserApplicationType = {
  user: UserType;
  scopes: string[];
  // last_login: string; // Removed
}

type ApplicationType = {
  id: string;
  name: string;
  category: string;
  risk_level: string;
  management_status: string;
  total_permissions: number;
  // last_login: string; // Removed
  user_applications: UserApplicationType[];
  all_scopes?: string[];
  created_at: string;
  microsoft_app_id?: string;
  owner_email?: string;
  notes?: string;
}

// Helper to generate app logo URL from logo.dev
function getAppLogoUrl(appName: string) {
  const domain = appNameToDomain(appName);
  
  // Try to get the app icon using Logo.dev
  const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
  
  // We could also provide a fallback URL using other icon services if needed
  // This gives us multiple ways to find a logo if the primary method fails
  const fallbackUrl = `https://icon.horse/icon/${domain}`;
  
  // Return both URLs so the frontend can try multiple sources
  return {
    primary: logoUrl,
    fallback: fallbackUrl
  };
}

// Helper to convert app name to likely domain format
function appNameToDomain(appName: string): string {
  // Common apps with special domain formats
  const knownDomains: Record<string, string> = {
    'slack': 'slack.com',
    'stitchflow': 'stitchflow.io',
    'yeshid': 'yeshid.com',
    'onelogin': 'onelogin.com',
    'google drive': 'drive.google.com',
    'google chrome': 'google.com',
    'accessowl': 'accessowl.com',
    'accessowl scanner': 'accessowl.com',
    'mode analytics': 'mode.com',
    'hubspot': 'hubspot.com',
    'github': 'github.com',
    'gmail': 'gmail.com',
    'zoom': 'zoom.us',
    'notion': 'notion.so',
    'figma': 'figma.com',
    'jira': 'atlassian.com',
    'confluence': 'atlassian.com',
    'asana': 'asana.com',
    'trello': 'trello.com',
    'dropbox': 'dropbox.com',
    'box': 'box.com',
    'microsoft': 'microsoft.com',
    'office365': 'office.com'
  };
  
  // Convert app name to lowercase for case-insensitive lookup
  const lowerAppName = appName.toLowerCase();
  
  // Check for exact matches in known domains
  if (knownDomains[lowerAppName]) {
    return knownDomains[lowerAppName];
  }
  
  // Check for partial matches (e.g., if app name contains known key)
  for (const [key, domain] of Object.entries(knownDomains)) {
    if (lowerAppName.includes(key)) {
      return domain;
    }
  }
  
  // Default processing for unknown apps
  // Remove special characters, spaces, and convert to lowercase
  const sanitized = lowerAppName
    .replace(/[^\w\s-]/gi, '')  // Keep hyphens as they're common in domains
    .replace(/\s+/g, '');
  
  // Default to .com instead of .io
  return sanitized + '.com';
}

// Helper function to get integrations (copied from bulk-update route)
async function getIntegrations() {
  try {
    const response = await fetch(
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/stitchflow-intg%20list-K5UBvEAIl4xhSgVYxIckYWH6WsdxMh.csv",
    );
    const csvText = await response.text();
    const lines = csvText.split("\n");
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      if (values.length >= 2) {
        const name = values[0];
        const status = values[1];
        if (name && status) {
          let mappedStatus = "Not connected";
          if (status.toLowerCase().includes("csv") && status.toLowerCase().includes("api coming soon")) {
            mappedStatus = "Yes - CSV Sync";
          } else if (status.toLowerCase().includes("api")) {
            mappedStatus = "Yes - API";
          } else if (status.toLowerCase().includes("csv")) {
            mappedStatus = "Yes - CSV Sync";
          }
          data.push({ name, connectionStatus: mappedStatus });
        }
      }
    }
    return data;
  } catch (err) {
    console.error("Error fetching integrations:", err);
    return [];
  }
}

// Sync function to update App Inbox when Shadow IT status changes
async function syncToAppInbox(app: any, managementStatus: string) {
  try {
    console.log(`Syncing app ${app.name} with status ${managementStatus} to App Inbox`);
    
    if (!app.organization_id) {
      console.warn(`Skipping app sync for ${app.name} because organization_id is missing.`);
      return;
    }

    // Handle comma-separated shadow org IDs
    const shadowOrgIds = app.organization_id.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0);
    
    if (shadowOrgIds.length === 0) {
      console.warn(`Invalid shadow_org_id: ${app.organization_id}`);
      return;
    }

    let organization = null;
    let allShadowOrgIds: string[] = [];

    // Try each shadow org ID to find which one contains the shadow org ID
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: org, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('id, shadow_org_id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single();

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !org) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('id, shadow_org_id')
          .not('shadow_org_id', 'is', null);

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const foundOrg = orgs.find(orgItem => {
            if (!orgItem.shadow_org_id) return false;
            const orgShadowIds = orgItem.shadow_org_id.split(',').map((id: string) => id.trim());
            return orgShadowIds.includes(singleShadowOrgId);
          });
          
          if (foundOrg) {
            org = { id: foundOrg.id, shadow_org_id: foundOrg.shadow_org_id };
            orgError = null; // Clear the error since we found a match
          }
        }
      }

      if (!orgError && org) {
        organization = org;
        // Get all shadow org IDs from the managed app list organization
        if (org.shadow_org_id) {
          allShadowOrgIds = org.shadow_org_id.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0);
        }
        break;
      }
    }

    if (!organization) {
      console.warn(`Organization not found for shadow_org_id: ${app.organization_id}`);
      return;
    }

    // Check if the app already exists in the apps table
    const { data: existingApp, error: findError } = await organizeSupabaseAdmin
      .from('apps')
      .select('id')
      .eq('name', app.name)
      .eq('org_id', organization.id)
      .single();

    if (findError && findError.code !== 'PGRST116') { // PGRST116: 'exact-one-row-not-found'
      console.error('Error finding app in App Inbox:', findError);
      return;
    }

    // If app exists, update it
    if (existingApp) {
      console.log(`Updating existing app ${app.name} in App Inbox with status ${managementStatus}`);
      const { error: updateError } = await organizeSupabaseAdmin
        .from('apps')
        .update({ managed_status: managementStatus })
        .eq('id', existingApp.id)
        .eq('org_id', organization.id);

      if (updateError) {
        console.error('Error updating app in App Inbox:', updateError);
      } else {
        console.log(`Successfully updated app ${app.name} in App Inbox`);
        
        // NEW: Sync status back to all other Shadow IT orgs that share this managed app list
        await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
      }
    } else {
      // If app does not exist, only create it if status is "Managed"
      if (managementStatus === "Managed") {
        const integrations = await getIntegrations();
        const integration = integrations.find(int => int.name.toLowerCase() === app.name.toLowerCase());
        const connectionStatus = integration ? integration.connectionStatus : "Yes - CSV Sync";

        console.log(`Creating new app ${app.name} in App Inbox with status ${managementStatus}`);
        const { error: createError } = await organizeSupabaseAdmin
          .from('apps')
          .insert({
            name: app.name,
            managed_status: managementStatus,
            org_id: organization.id,
            stitchflow_status: connectionStatus,
          });
        
        if (createError) {
          console.error('Error creating app in App Inbox:', createError);
        } else {
          console.log(`Successfully created app ${app.name} in App Inbox`);
          
          // NEW: Sync status back to all other Shadow IT orgs that share this managed app list
          await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
        }
      } else {
        console.log(`App ${app.name} not found in App Inbox and status is ${managementStatus} - skipping creation`);
        
        // NEW: Even if app doesn't exist in managed list, sync status to other shadow orgs if they have the app
        await syncStatusToOtherShadowOrgs(app.name, managementStatus, allShadowOrgIds, app.organization_id);
      }
    }
  } catch (error) {
    console.error('Error syncing to App Inbox:', error);
  }
}

// NEW: Function to sync managed status to all other Shadow IT orgs that share the same managed app list
async function syncStatusToOtherShadowOrgs(appName: string, managementStatus: string, allShadowOrgIds: string[], currentShadowOrgId: string) {
  try {
    console.log(`Syncing status ${managementStatus} for app ${appName} to other Shadow IT orgs`);
    
    // Get the current shadow org ID (the one that initiated the change)
    const currentShadowOrgIds = currentShadowOrgId.split(',').map((id: string) => id.trim());
    
    // Find other shadow org IDs that need to be synced (exclude the current one)
    const otherShadowOrgIds = allShadowOrgIds.filter(id => !currentShadowOrgIds.includes(id));
    
    if (otherShadowOrgIds.length === 0) {
      console.log(`No other Shadow IT orgs to sync for app ${appName}`);
      return;
    }
    
    console.log(`Found ${otherShadowOrgIds.length} other Shadow IT orgs to sync: ${otherShadowOrgIds.join(', ')}`);
    
    // Update the managed status in all other Shadow IT orgs
    for (const shadowOrgId of otherShadowOrgIds) {
      try {
        // Find apps with this name in the other Shadow IT org
        const { data: appsToUpdate, error: findAppsError } = await supabaseAdmin
          .from('applications')
          .select('id, name, organization_id')
          .eq('organization_id', shadowOrgId)
          .ilike('name', appName); // Use ilike for case-insensitive matching
        
        if (findAppsError) {
          console.error(`Error finding apps in Shadow IT org ${shadowOrgId}:`, findAppsError);
          continue;
        }
        
        if (!appsToUpdate || appsToUpdate.length === 0) {
          console.log(`App ${appName} not found in Shadow IT org ${shadowOrgId} - skipping`);
          continue;
        }
        
        // Update each matching app
        for (const appToUpdate of appsToUpdate) {
          const { error: updateError } = await supabaseAdmin
            .from('applications')
            .update({ management_status: managementStatus })
            .eq('id', appToUpdate.id);
          
          if (updateError) {
            console.error(`Error updating app ${appToUpdate.name} in Shadow IT org ${shadowOrgId}:`, updateError);
          } else {
            console.log(`Successfully synced status ${managementStatus} for app ${appToUpdate.name} in Shadow IT org ${shadowOrgId}`);
          }
        }
        
      } catch (error) {
        console.error(`Error syncing to Shadow IT org ${shadowOrgId}:`, error);
      }
    }
    
  } catch (error) {
    console.error('Error syncing status to other Shadow IT orgs:', error);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Get applications with user data in a single query
    const { data: applications, error } = await supabaseAdmin
      .from('applications')
      .select(`
        *,
        user_applications:user_applications!inner (
          scopes,
          user:users!inner (
            id,
            name,
            email,
            role,
            department,
            created_at
          )
        )
      `)
      .eq('organization_id', orgId)
      .limit(10000);

    if (error) {
      throw error;
    }

    if (!applications) {
      return NextResponse.json({ error: 'No applications found' }, { status: 404 });
    }

    // **NEW: Group applications by name to handle duplicates from cron job**
    console.log(`Found ${applications.length} application records before deduplication`);
    
    const appsByName = new Map<string, ApplicationType[]>();
    
    // Group applications by name
    (applications as ApplicationType[]).forEach(app => {
      const appName = app.name;
      if (!appsByName.has(appName)) {
        appsByName.set(appName, []);
      }
      appsByName.get(appName)!.push(app);
    });
    
    console.log(`Grouped into ${appsByName.size} unique application names`);

    // Transform and deduplicate applications
    const transformedApplications = Array.from(appsByName.entries()).map(([appName, appInstances]) => {
      // Combine all user applications from all instances of this app
      const allUserApplications: UserApplicationType[] = [];
      const allScopes = new Set<string>();
      let totalPermissions = 0;
      let highestRiskLevel = 'LOW';
      let latestCreatedAt = '';
      let managementStatus = 'Newly discovered';
      let ownerEmail = '';
      let notes = '';
      let isMicrosoftApp = false;
      
      // Process each instance of the application
      appInstances.forEach(app => {
        // Collect all user applications
        const validUserApplications = (app.user_applications || [])
          .filter(ua => ua.user != null && ua.scopes != null);
        
        allUserApplications.push(...validUserApplications);
        
        // Collect all scopes
        if (app.all_scopes) {
          app.all_scopes.forEach(scope => allScopes.add(scope));
        }
        
        // Get scopes from user applications as fallback
        validUserApplications.forEach(ua => {
          (ua.scopes || []).forEach(scope => allScopes.add(scope));
        });
        
        // Track highest risk level (case-insensitive)
        const currentRisk = (app.risk_level || 'low').toUpperCase();
        if (currentRisk === 'HIGH') {
          highestRiskLevel = 'HIGH';
        } else if (currentRisk === 'MEDIUM' && highestRiskLevel !== 'HIGH') {
          highestRiskLevel = 'MEDIUM';
        }
        
        // Use the highest permission count
        totalPermissions = Math.max(totalPermissions, app.total_permissions || 0);
        
        // Use the latest created date
        if (app.created_at > latestCreatedAt) {
          latestCreatedAt = app.created_at;
        }
        
        // Preserve management status (prefer non-default values)
        if (app.management_status && app.management_status !== 'Newly discovered') {
          managementStatus = app.management_status;
        }
        
        // Preserve owner email and notes
        if (app.owner_email) ownerEmail = app.owner_email;
        if (app.notes) notes = app.notes;
        
        // Check if any instance is Microsoft
        if (app.microsoft_app_id) isMicrosoftApp = true;
      });
      
      // Deduplicate users (same user might appear in multiple app instances)
      const uniqueUsers = new Map<string, any>();
      const userScopesMap = new Map<string, Set<string>>();
      
      allUserApplications.forEach(ua => {
        const userId = ua.user.id;
        if (!uniqueUsers.has(userId)) {
          uniqueUsers.set(userId, ua.user);
          userScopesMap.set(userId, new Set());
        }
        
        // Combine scopes for this user
        (ua.scopes || []).forEach(scope => {
          userScopesMap.get(userId)!.add(scope);
        });
      });
      
      // Use the first app instance as the base (for ID, category, etc.)
      const baseApp = appInstances[0];
      
      // Get logo URLs
      const logoUrls = getAppLogoUrl(appName);

      return {
        id: baseApp.id, // Use the first instance's ID
        name: appName,
        category: baseApp.category || 'Others',
        userCount: uniqueUsers.size,
        users: Array.from(uniqueUsers.entries()).map(([userId, user]) => {
          const userScopes = Array.from(userScopesMap.get(userId) || []);
          
          return {
            id: user.id,
            appId: baseApp.id,
            name: user.name,
            email: user.email,
            scopes: userScopes,
            scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
            created_at: user.created_at,
            riskLevel: determineRiskLevel(userScopes),
            riskReason: determineRiskReason(userScopes)
          };
        }),
        riskLevel: transformRiskLevel(highestRiskLevel),
        riskReason: determineAppRiskReason(highestRiskLevel, Math.max(totalPermissions, allScopes.size)),
        totalPermissions: Math.max(totalPermissions, allScopes.size),
        scopeVariance: calculateScopeVariance(Array.from(uniqueUsers.values()).map(user => ({
          scopes: Array.from(userScopesMap.get(user.id) || [])
        }))),
        logoUrl: logoUrls.primary,
        logoUrlFallback: logoUrls.fallback,
        created_at: latestCreatedAt || baseApp.created_at,
        managementStatus: transformManagementStatus(managementStatus),
        ownerEmail: ownerEmail,
        notes: notes,
        scopes: Array.from(allScopes),
        scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
        isInstalled: managementStatus === 'MANAGED',
        isAuthAnonymously: false,
        provider: isMicrosoftApp ? 'microsoft' : 'google'
      };
    });

    console.log(`Returning ${transformedApplications.length} deduplicated applications`);
    return NextResponse.json(transformedApplications);
  } catch (error) {
    console.error('Error in applications API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function transformManagementStatus(status: string): 'Managed' | 'Unmanaged' | 'Newly discovered' | 'Needs review' {
  const validStatuses: ('Managed' | 'Unmanaged' | 'Newly discovered' | 'Needs review')[] = [
    'Managed',
    'Unmanaged',
    'Newly discovered',
    'Needs review'
  ];

  if (validStatuses.includes(status as any)) {
    return status as 'Managed' | 'Unmanaged' | 'Newly discovered' | 'Needs review';
  }
  
  // Handle backward compatibility - convert old statuses to "Newly discovered"
  if (status === 'Unknown' || status === 'Ignore' || status === 'Not specified') {
    return 'Newly discovered';
  }
  
  return 'Newly discovered';
}

function calculateScopeVariance(userApplications: any[] | null): { userGroups: number; scopeGroups: number } {
  if (!userApplications) {
    return { userGroups: 0, scopeGroups: 0 };
  }

  const uniqueScopeSets = new Set(
    userApplications.map(ua => (ua.scopes || []).sort().join('|'))
  );

  return {
    userGroups: uniqueScopeSets.size,
    scopeGroups: Math.min(uniqueScopeSets.size, 5)  // Simplified as per original code
  };
}

export async function PATCH(request: Request) {
  try {
    const { id, managementStatus, ownerEmail, notes } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Application ID is required' }, { status: 400 });
    }

    // Build update object based on what was provided
    const updateData: any = {};
    
    if (managementStatus) {
      // Validate management status
      if (!['Managed', 'Unmanaged', 'Newly discovered', 'Needs review'].includes(managementStatus)) {
        return NextResponse.json({ error: 'Invalid management status' }, { status: 400 });
      }
      updateData.management_status = managementStatus;
    }
    
    // Add owner_email if provided
    if (ownerEmail !== undefined) {
      updateData.owner_email = ownerEmail;
    }
    
    // Add notes if provided
    if (notes !== undefined) {
      updateData.notes = notes;
    }
    
    // If nothing to update, return an error
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No update parameters provided' }, { status: 400 });
    }

    // Update the application in Shadow IT
    const { data: updatedApp, error } = await supabaseAdmin
      .from('applications')
      .update(updateData)
      .eq('id', id)
      .select('id, name, organization_id, management_status')
      .single();

    if (error) {
      throw error;
    }

    // Sync to App Inbox if managementStatus was changed
    if (managementStatus && updatedApp) {
      await syncToAppInbox(updatedApp, managementStatus);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating application:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, orgId } = await request.json();

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    if (action === 'merge_duplicates') {
      return await mergeDuplicateApplications(orgId);
    }

    if (action === 'fix_risk_levels') {
      return await fixApplicationRiskLevels(orgId);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error in applications POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function mergeDuplicateApplications(orgId: string) {
  try {
    console.log(`Starting duplicate application merge for organization: ${orgId}`);

    // Get all applications for this organization
    const { data: applications, error: fetchError } = await supabaseAdmin
      .from('applications')
      .select('*')
      .eq('organization_id', orgId);

    if (fetchError) {
      throw fetchError;
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({ message: 'No applications found' });
    }

    console.log(`Found ${applications.length} applications before deduplication`);

    // Group applications by name
    const appsByName = new Map<string, any[]>();
    applications.forEach(app => {
      const appName = app.name;
      if (!appsByName.has(appName)) {
        appsByName.set(appName, []);
      }
      appsByName.get(appName)!.push(app);
    });

    const duplicateGroups = Array.from(appsByName.entries()).filter(([_, apps]) => apps.length > 1);
    
    if (duplicateGroups.length === 0) {
      return NextResponse.json({ 
        message: 'No duplicate applications found',
        totalApplications: applications.length,
        uniqueApplications: appsByName.size
      });
    }

    console.log(`Found ${duplicateGroups.length} groups of duplicate applications`);

    let mergedCount = 0;
    let deletedCount = 0;

    // Process each group of duplicates
    for (const [appName, duplicateApps] of duplicateGroups) {
      console.log(`Processing duplicates for "${appName}": ${duplicateApps.length} instances`);

      // Sort by created_at to keep the oldest one as the primary
      duplicateApps.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      const primaryApp = duplicateApps[0];
      const duplicatesToMerge = duplicateApps.slice(1);

      // Collect all unique scopes from all instances
      const allScopes = new Set<string>();
      let totalPermissions = 0;
      let highestRiskLevel = 'LOW';

      duplicateApps.forEach(app => {
        // Collect scopes
        if (app.all_scopes && Array.isArray(app.all_scopes)) {
          app.all_scopes.forEach((scope: string) => allScopes.add(scope));
        }

        // Track highest risk level
        const currentRisk = (app.risk_level || 'low').toUpperCase();
        if (currentRisk === 'HIGH') {
          highestRiskLevel = 'HIGH';
        } else if (currentRisk === 'MEDIUM' && highestRiskLevel !== 'HIGH') {
          highestRiskLevel = 'MEDIUM';
        }

        // Use highest permission count
        totalPermissions = Math.max(totalPermissions, app.total_permissions || 0);
      });

      // Update the primary application with combined data
      const { error: updateError } = await supabaseAdmin
        .from('applications')
        .update({
          all_scopes: Array.from(allScopes),
          total_permissions: Math.max(totalPermissions, allScopes.size),
          risk_level: highestRiskLevel,
          google_app_id: duplicateApps.map(app => app.google_app_id).filter(Boolean).join(','),
          updated_at: new Date().toISOString()
        })
        .eq('id', primaryApp.id);

      if (updateError) {
        console.error(`Error updating primary app ${primaryApp.id}:`, updateError);
        continue;
      }

      // **OPTIMIZED: Bulk process all user_applications for this app group**
      const duplicateAppIds = duplicatesToMerge.map(app => app.id);
      
      // Get all user_applications for all duplicate apps in one query
      const { data: allDuplicateUserApps, error: fetchAllError } = await supabaseAdmin
        .from('user_applications')
        .select('user_id, application_id, scopes, created_at')
        .in('application_id', duplicateAppIds);

      if (fetchAllError) {
        console.error(`Error fetching user_applications for duplicate apps:`, fetchAllError);
        continue;
      }

      // Get existing relationships for primary app in one query
      const { data: existingPrimaryRelations, error: fetchPrimaryError } = await supabaseAdmin
        .from('user_applications')
        .select('user_id, id, scopes')
        .eq('application_id', primaryApp.id);

      if (fetchPrimaryError) {
        console.error(`Error fetching existing primary app relations:`, fetchPrimaryError);
        continue;
      }

      // Create maps for fast lookup
      const existingRelationsMap = new Map();
      existingPrimaryRelations?.forEach(rel => {
        existingRelationsMap.set(rel.user_id, rel);
      });

      const userScopeMap = new Map();
      allDuplicateUserApps?.forEach(userApp => {
        const userId = userApp.user_id;
        if (!userScopeMap.has(userId)) {
          userScopeMap.set(userId, {
            scopes: new Set(),
            created_at: userApp.created_at
          });
        }
        
        // Combine all scopes for this user across all duplicate apps
        const userScopes = userApp.scopes || [];
        userScopes.forEach((scope: string) => {
          userScopeMap.get(userId).scopes.add(scope);
        });
        
        // Keep earliest created_at
        if (userApp.created_at < userScopeMap.get(userId).created_at) {
          userScopeMap.get(userId).created_at = userApp.created_at;
        }
      });

      // Prepare bulk operations
      const updatesToProcess: any[] = [];
      const insertsToProcess: any[] = [];

      userScopeMap.forEach((userData, userId) => {
        const existingRelation = existingRelationsMap.get(userId);
        const allScopes = Array.from(userData.scopes);
        
        if (existingRelation) {
          // Merge with existing relationship
          const existingScopes = new Set(existingRelation.scopes || []);
          allScopes.forEach(scope => existingScopes.add(scope));
          
          updatesToProcess.push({
            id: existingRelation.id,
            scopes: Array.from(existingScopes),
            updated_at: new Date().toISOString()
          });
        } else {
          // Create new relationship
          insertsToProcess.push({
            user_id: userId,
            application_id: primaryApp.id,
            scopes: allScopes,
            created_at: userData.created_at,
            updated_at: new Date().toISOString()
          });
        }
      });

      // Execute bulk operations
      if (updatesToProcess.length > 0) {
        console.log(`Processing ${updatesToProcess.length} scope updates for "${appName}"`);
        // Use upsert for bulk updates (more efficient than individual updates)
        const { error: bulkUpdateError } = await supabaseAdmin
          .from('user_applications')
          .upsert(updatesToProcess, { 
            onConflict: 'id',
            ignoreDuplicates: false 
          });
        
        if (bulkUpdateError) {
          console.error(`Error bulk updating user_applications:`, bulkUpdateError);
          // Fallback to individual updates if bulk fails
          for (const update of updatesToProcess) {
            const { error: updateError } = await supabaseAdmin
              .from('user_applications')
              .update({
                scopes: update.scopes,
                updated_at: update.updated_at
              })
              .eq('id', update.id);
            
            if (updateError) {
              console.error(`Error updating user_application ${update.id}:`, updateError);
            }
          }
        }
      }

      if (insertsToProcess.length > 0) {
        console.log(`Creating ${insertsToProcess.length} new user-app relationships for "${appName}"`);
        // Process inserts in batches of 100 to avoid payload limits
        for (let i = 0; i < insertsToProcess.length; i += 100) {
          const batch = insertsToProcess.slice(i, i + 100);
          const { error: insertError } = await supabaseAdmin
            .from('user_applications')
            .insert(batch);
          
          if (insertError) {
            console.error(`Error inserting user_applications batch ${i}-${i + batch.length}:`, insertError);
          }
        }
      }

      // Delete all user_applications for duplicate apps in one operation
      const { error: deleteRelationsError } = await supabaseAdmin
        .from('user_applications')
        .delete()
        .in('application_id', duplicateAppIds);

      if (deleteRelationsError) {
        console.error(`Error deleting user_applications for duplicate apps:`, deleteRelationsError);
        continue;
      }

      // Delete all duplicate applications in one operation
      const { error: deleteAppsError } = await supabaseAdmin
        .from('applications')
        .delete()
        .in('id', duplicateAppIds);

      if (deleteAppsError) {
        console.error(`Error deleting duplicate apps:`, deleteAppsError);
      } else {
        deletedCount += duplicateAppIds.length;
      }

      mergedCount++;
      console.log(`Merged ${duplicateApps.length} instances of "${appName}" into primary app ${primaryApp.id}`);
    }

    // Clean up any duplicate user_applications that might have been created
    console.log('Cleaning up duplicate user_applications...');
    
    try {
      // Find and remove duplicate user_applications, keeping the one with the most scopes
      const { data: duplicateUserApps, error: fetchDuplicatesError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          id,
          user_id,
          application_id,
          scopes,
          created_at,
          applications!inner(organization_id)
        `)
        .eq('applications.organization_id', orgId);

      if (fetchDuplicatesError) {
        console.warn('Error fetching user_applications for cleanup:', fetchDuplicatesError);
      } else if (duplicateUserApps) {
        // Group by user_id + application_id to find duplicates
        const userAppGroups = new Map<string, any[]>();
        
        duplicateUserApps.forEach(ua => {
          const key = `${ua.user_id}-${ua.application_id}`;
          if (!userAppGroups.has(key)) {
            userAppGroups.set(key, []);
          }
          userAppGroups.get(key)!.push(ua);
        });

        // Find groups with duplicates
        const duplicateGroups = Array.from(userAppGroups.values()).filter(group => group.length > 1);
        
        if (duplicateGroups.length > 0) {
          console.log(`Found ${duplicateGroups.length} groups of duplicate user_applications`);
          
          const idsToDelete: string[] = [];
          
          duplicateGroups.forEach(group => {
            // Sort by scope count (descending) then by created_at (ascending) to keep the best one
            group.sort((a, b) => {
              const scopeCountA = (a.scopes || []).length;
              const scopeCountB = (b.scopes || []).length;
              
              if (scopeCountA !== scopeCountB) {
                return scopeCountB - scopeCountA; // More scopes first
              }
              
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); // Earlier created first
            });
            
            // Keep the first one, delete the rest
            const toDelete = group.slice(1);
            idsToDelete.push(...toDelete.map(ua => ua.id));
          });
          
          if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabaseAdmin
              .from('user_applications')
              .delete()
              .in('id', idsToDelete);
              
            if (deleteError) {
              console.warn('Error deleting duplicate user_applications:', deleteError);
            } else {
              console.log(`Successfully deleted ${idsToDelete.length} duplicate user_applications`);
            }
          }
        } else {
          console.log('No duplicate user_applications found');
        }
      }
    } catch (cleanupError) {
      console.warn('Error during user_applications cleanup:', cleanupError);
    }

    const finalCount = appsByName.size;

    return NextResponse.json({
      success: true,
      message: `Successfully merged duplicate applications`,
      originalCount: applications.length,
      finalCount: finalCount,
      duplicateGroupsProcessed: mergedCount,
      applicationsDeleted: deletedCount,
      duplicateGroups: duplicateGroups.map(([name, apps]) => ({
        name,
        instanceCount: apps.length,
        ids: apps.map(app => app.id)
      }))
    });

  } catch (error) {
    console.error('Error merging duplicate applications:', error);
    return NextResponse.json({ error: 'Failed to merge duplicates', details: (error as Error).message }, { status: 500 });
  }
}

async function fixApplicationRiskLevels(orgId: string) {
  try {
    console.log(`Starting risk level fix for organization: ${orgId}`);

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
      return NextResponse.json({ message: 'No applications found' });
    }

    console.log(`Found ${applications.length} applications to fix`);

    let fixedCount = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;

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
        // Don't include all_scopes to avoid inflating risk for unused permissions
        const userScopes = Array.from(allUserScopes);
        
        // Keep all_scopes for reference but use user scopes for risk calculation
        const allAppScopes = new Set<string>(allUserScopes);
        if (app.all_scopes && Array.isArray(app.all_scopes)) {
          app.all_scopes.forEach((scope: string) => allAppScopes.add(scope));
        }
        
        const allScopes = userScopes; // Use only user scopes for risk calculation
        
        // Recalculate risk level based on all scopes
        const newRiskLevel = determineRiskLevel(allScopes);
        const normalizedRiskLevel = newRiskLevel.toUpperCase();
        
        // Update the application with correct risk level and scope count
        const { error: updateError } = await supabaseAdmin
          .from('applications')
          .update({
            risk_level: normalizedRiskLevel,
            total_permissions: allScopes.length, // User scope count for risk calculation
            all_scopes: Array.from(allAppScopes), // Preserve all application scopes for reference
            updated_at: new Date().toISOString()
          })
          .eq('id', app.id);

        if (updateError) {
          console.error(`Error updating app ${app.name} (${app.id}):`, updateError);
          continue;
        }

        // Count by risk level
        switch (normalizedRiskLevel) {
          case 'HIGH':
            highRiskCount++;
            break;
          case 'MEDIUM':
            mediumRiskCount++;
            break;
          default:
            lowRiskCount++;
        }

        fixedCount++;
        
        if (normalizedRiskLevel !== 'LOW') {
          console.log(`Fixed ${app.name}: ${allScopes.length} user scopes → ${normalizedRiskLevel} risk (${Array.from(allAppScopes).length} total app scopes)`);
        }

      } catch (error) {
        console.error(`Error processing app ${app.name}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully fixed risk levels for ${fixedCount} applications`,
      summary: {
        totalProcessed: fixedCount,
        highRisk: highRiskCount,
        mediumRisk: mediumRiskCount,
        lowRisk: lowRiskCount
      },
      details: {
        originalApplications: applications.length,
        applicationsFixed: fixedCount
      }
    });

  } catch (error) {
    console.error('Error fixing application risk levels:', error);
    return NextResponse.json({ 
      error: 'Failed to fix risk levels', 
      details: (error as Error).message 
    }, { status: 500 });
  }
} 