import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
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
      let managementStatus = 'Not specified';
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
        
        // Track highest risk level
        if (app.risk_level === 'HIGH') highestRiskLevel = 'HIGH';
        else if (app.risk_level === 'MEDIUM' && highestRiskLevel !== 'HIGH') highestRiskLevel = 'MEDIUM';
        
        // Use the highest permission count
        totalPermissions = Math.max(totalPermissions, app.total_permissions || 0);
        
        // Use the latest created date
        if (app.created_at > latestCreatedAt) {
          latestCreatedAt = app.created_at;
        }
        
        // Preserve management status (prefer non-default values)
        if (app.management_status && app.management_status !== 'Not specified') {
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

function transformManagementStatus(status: string): 'Managed' | 'Unmanaged' | 'Newly discovered' | 'Unknown' | 'Ignore' | 'Not specified' {
  const validStatuses: ('Managed' | 'Unmanaged' | 'Newly discovered' | 'Unknown' | 'Ignore' | 'Not specified')[] = [
    'Managed',
    'Unmanaged',
    'Newly discovered',
    'Unknown',
    'Ignore',
    'Not specified'
  ];

  if (validStatuses.includes(status as any)) {
    return status as 'Managed' | 'Unmanaged' | 'Newly discovered' | 'Unknown' | 'Ignore' | 'Not specified';
  }
  
  // Handle backward compatibility
  if (status === 'Needs Review') {
    return 'Not specified';
  }
  
  return 'Not specified';
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
      if (!['Managed', 'Unmanaged', 'Newly discovered', 'Unknown', 'Ignore', 'Not specified'].includes(managementStatus)) {
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

    const { error } = await supabaseAdmin
      .from('applications')
      .update(updateData)
      .eq('id', id);

    if (error) {
      throw error;
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
        if (app.risk_level === 'HIGH') highestRiskLevel = 'HIGH';
        else if (app.risk_level === 'MEDIUM' && highestRiskLevel !== 'HIGH') highestRiskLevel = 'MEDIUM';

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

      // Move all user_applications from duplicates to the primary app
      for (const duplicateApp of duplicatesToMerge) {
        // Update user_applications to point to the primary app
        const { error: relationError } = await supabaseAdmin
          .from('user_applications')
          .update({ application_id: primaryApp.id })
          .eq('application_id', duplicateApp.id);

        if (relationError) {
          console.error(`Error updating user_applications for app ${duplicateApp.id}:`, relationError);
          continue;
        }

        // Delete the duplicate application
        const { error: deleteError } = await supabaseAdmin
          .from('applications')
          .delete()
          .eq('id', duplicateApp.id);

        if (deleteError) {
          console.error(`Error deleting duplicate app ${duplicateApp.id}:`, deleteError);
        } else {
          deletedCount++;
        }
      }

      mergedCount++;
      console.log(`Merged ${duplicateApps.length} instances of "${appName}" into primary app ${primaryApp.id}`);
    }

    // Clean up any duplicate user_applications that might have been created
    const { error: cleanupError } = await supabaseAdmin.rpc('remove_duplicate_user_applications', {
      org_id: orgId
    });

    if (cleanupError) {
      console.warn('Error cleaning up duplicate user_applications:', cleanupError);
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