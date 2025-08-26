import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel, determineRiskReason, transformRiskLevel, determineAppRiskReason } from '@/lib/risk-assessment';

// Server-side cache for applications data
const APP_CACHE = new Map<string, { data: any[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes server-side cache

// Define optimized types
type OptimizedApplication = {
  id: string;
  name: string;
  category: string;
  risk_level: string;
  management_status: string;
  total_permissions: number;
  created_at: string;
  microsoft_app_id?: string;
  owner_email?: string;
  notes?: string;
  all_scopes?: string[];
  user_count?: number;
};

type UserCountData = {
  application_id: string;
  user_count: number;
};

// Helper functions (reused from original)
function getAppLogoUrl(appName: string) {
  const domain = appNameToDomain(appName);
  
  const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
  const fallbackUrl = `https://icon.horse/icon/${domain}`;
  
  return {
    primary: logoUrl,
    fallback: fallbackUrl
  };
}

function appNameToDomain(appName: string): string {
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
  
  const lowerAppName = appName.toLowerCase();
  
  if (knownDomains[lowerAppName]) {
    return knownDomains[lowerAppName];
  }
  
  for (const [key, domain] of Object.entries(knownDomains)) {
    if (lowerAppName.includes(key)) {
      return domain;
    }
  }
  
  const sanitized = lowerAppName
    .replace(/[^\w\s-]/gi, '')
    .replace(/\s+/g, '');
  
  return sanitized + '.com';
}

function calculateScopeVariance(userApplications: any[]): { userGroups: number; scopeGroups: number } {
  if (!userApplications || userApplications.length === 0) {
    return { userGroups: 0, scopeGroups: 0 };
  }

  const uniqueScopeSets = new Set(
    userApplications.map(ua => (ua.scopes || []).sort().join('|'))
  );

  return {
    userGroups: uniqueScopeSets.size,
    scopeGroups: Math.min(uniqueScopeSets.size, 5)
  };
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

// Check cache validity
function getCachedData(cacheKey: string) {
  const cached = APP_CACHE.get(cacheKey);
  if (!cached) return null;
  
  const isExpired = Date.now() - cached.timestamp > CACHE_TTL;
  if (isExpired) {
    APP_CACHE.delete(cacheKey);
    return null;
  }
  
  return cached.data;
}

// Set cache data
function setCachedData(cacheKey: string, data: any[]) {
  APP_CACHE.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  // Clean up old cache entries (simple LRU-like)
  if (APP_CACHE.size > 100) {
    const oldestKey = APP_CACHE.keys().next().value;
    if (oldestKey) {
      APP_CACHE.delete(oldestKey);
    }
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const includeUsers = searchParams.get('includeUsers') === 'true';
    const cacheBuster = searchParams.get('cb');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    console.log(`[PERF] Applications-v2 API called for org: ${orgId}, page: ${page}, limit: ${limit}`);

    // Check cache first (include all parameters in cache key for consistency)
    const cacheKey = `apps_${orgId}_${page}_${limit}_${includeUsers}`;
    const cachedData = getCachedData(cacheKey);
    
    if (cachedData && !includeUsers && !cacheBuster) {
      console.log(`[PERF] Cache hit for ${cacheKey}, returning cached data in ${Date.now() - startTime}ms`);
      return NextResponse.json({
        applications: cachedData,
        fromCache: true,
        responseTime: Date.now() - startTime
      });
    }

    // OPTIMIZED QUERY 1: Get applications only (no JOIN)
    const queryStart = Date.now();
    const { data: applications, error: appsError } = await supabaseAdmin
      .from('applications')
      .select(`
        id,
        name,
        category,
        risk_level,
        management_status,
        total_permissions,
        created_at,
        microsoft_app_id,
        owner_email,
        notes,
        all_scopes,
        organization_id
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (appsError) {
      throw appsError;
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({ 
        applications: [], 
        message: 'No applications found',
        responseTime: Date.now() - startTime
      });
    }

    // Get total count for proper pagination
    const { count: totalCount, error: countError } = await supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);

    if (countError) {
      console.warn('Error getting total count:', countError);
    }

    console.log(`[PERF] Applications query completed in ${Date.now() - queryStart}ms, found ${applications.length} apps`);

    // OPTIMIZED QUERY 2: Get user data (counts + details if requested)
    const userDataStart = Date.now();
    const appIds = applications.map(app => app.id);
    
    let userCountMap = new Map<string, number>();
    let userDetailsMap = new Map<string, any[]>();

    if (includeUsers) {
      // Get full user details when requested
      const { data: userApplications, error: userError } = await supabaseAdmin
        .from('user_applications')
        .select(`
          application_id,
          scopes,
          user:users!inner (
            id,
            name,
            email,
            role,
            department,
            created_at
          )
        `)
        .in('application_id', appIds);

      if (userError) {
        console.warn('Error fetching user details:', userError);
      } else if (userApplications) {
        // Process user details
        userApplications.forEach((ua: any) => {
          const appId = ua.application_id;
          
          // Count users
          const currentCount = userCountMap.get(appId) || 0;
          userCountMap.set(appId, currentCount + 1);
          
          // Store user details
          if (!userDetailsMap.has(appId)) {
            userDetailsMap.set(appId, []);
          }
          userDetailsMap.get(appId)!.push({
            id: ua.user?.id,
            name: ua.user?.name,
            email: ua.user?.email,
            role: ua.user?.role,
            department: ua.user?.department,
            created_at: ua.user?.created_at,
            scopes: ua.scopes || []
          });
        });
      }
    } else {
      // Get only user counts for performance
      const { data: userCounts, error: countError } = await supabaseAdmin
        .from('user_applications')
        .select('application_id')
        .in('application_id', appIds);

      if (countError) {
        console.warn('Error fetching user counts:', countError);
      } else if (userCounts) {
        userCounts.forEach(uc => {
          const currentCount = userCountMap.get(uc.application_id) || 0;
          userCountMap.set(uc.application_id, currentCount + 1);
        });
      }
    }

    console.log(`[PERF] User ${includeUsers ? 'details' : 'counts'} query completed in ${Date.now() - userDataStart}ms`);

    // Optional deduplication - controlled by query parameter
    const deduplicate = searchParams.get('deduplicate') === 'true';
    const dedupeStart = Date.now();
    
    let appsToProcess: OptimizedApplication[][];
    
    if (deduplicate) {
      // Group applications by name (handle duplicates) - OPTIONAL
      const appsByName = new Map<string, OptimizedApplication[]>();
      
      (applications as OptimizedApplication[]).forEach(app => {
        const appName = app.name;
        if (!appsByName.has(appName)) {
          appsByName.set(appName, []);
        }
        appsByName.get(appName)!.push(app);
      });

      console.log(`[PERF] Grouped ${applications.length} apps into ${appsByName.size} unique names in ${Date.now() - dedupeStart}ms`);
      appsToProcess = Array.from(appsByName.values());
    } else {
      // Process each app individually - NO DEDUPLICATION
      appsToProcess = (applications as OptimizedApplication[]).map(app => [app]);
      console.log(`[PERF] Processing ${applications.length} apps individually (no deduplication) in ${Date.now() - dedupeStart}ms`);
    }

    // Transform applications (optimized - no heavy user processing)
    const transformStart = Date.now();
    const transformedApplications = appsToProcess.map((appInstances) => {
      const baseApp = appInstances[0];
      
      // Aggregate data from all instances
      let totalUserCount = 0;
      let totalPermissions = 0;
      let highestRiskLevel = 'LOW';
      let latestCreatedAt = '';
      let managementStatus = 'Newly discovered';
      let ownerEmail = '';
      let notes = '';
      let isMicrosoftApp = false;
      const allScopes = new Set<string>();

      appInstances.forEach(app => {
        // Sum user counts
        totalUserCount += userCountMap.get(app.id) || 0;
        
        // Track highest values
        totalPermissions = Math.max(totalPermissions, app.total_permissions || 0);
        
        if (app.created_at > latestCreatedAt) {
          latestCreatedAt = app.created_at;
        }
        
        // Risk level priority
        const currentRisk = (app.risk_level || 'low').toUpperCase();
        if (currentRisk === 'HIGH') {
          highestRiskLevel = 'HIGH';
        } else if (currentRisk === 'MEDIUM' && highestRiskLevel !== 'HIGH') {
          highestRiskLevel = 'MEDIUM';
        }
        
        // Preserve important fields
        if (app.management_status && app.management_status !== 'Newly discovered') {
          managementStatus = app.management_status;
        }
        if (app.owner_email) ownerEmail = app.owner_email;
        if (app.notes) notes = app.notes;
        if (app.microsoft_app_id) isMicrosoftApp = true;
        
        // Collect scopes
        if (app.all_scopes) {
          app.all_scopes.forEach(scope => allScopes.add(scope));
        }
      });

      const logoUrls = getAppLogoUrl(baseApp.name);

      // Collect users from all app instances if requested
      const allUsers: any[] = [];
      if (includeUsers) {
        appInstances.forEach(app => {
          const appUsers = userDetailsMap.get(app.id) || [];
          allUsers.push(...appUsers);
        });
        
        // Deduplicate users by ID
        const uniqueUsers = new Map();
        const userScopesMap = new Map();
        
        allUsers.forEach(user => {
          if (!uniqueUsers.has(user.id)) {
            uniqueUsers.set(user.id, user);
            userScopesMap.set(user.id, new Set(user.scopes || []));
          } else {
            // Merge scopes for duplicate users
            (user.scopes || []).forEach((scope: string) => {
              userScopesMap.get(user.id).add(scope);
            });
          }
        });
        
                 // Transform to final user format
        const finalUsers = Array.from(uniqueUsers.values()).map((user: any) => {
          const userScopes = Array.from(userScopesMap.get(user.id) || []) as string[];
          return {
            id: user.id,
            appId: baseApp.id,
            name: user.name,
            email: user.email,
            role: user.role,
            department: user.department,
            created_at: user.created_at,
            scopes: userScopes,
            scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
            riskLevel: determineRiskLevel(userScopes),
            riskReason: determineRiskReason(userScopes)
          };
        });
        
        allUsers.length = 0; // Clear and replace with processed users
        allUsers.push(...finalUsers);
      }

      // Calculate scope variance
      const scopeVariance = includeUsers ? calculateScopeVariance(allUsers) : { userGroups: 0, scopeGroups: 0 };

      return {
        id: baseApp.id,
        name: baseApp.name,
        category: baseApp.category || 'Others',
        userCount: totalUserCount,
        users: includeUsers ? allUsers : undefined,
        riskLevel: transformRiskLevel(highestRiskLevel),
        riskReason: determineAppRiskReason(highestRiskLevel, Math.max(totalPermissions, allScopes.size)),
        totalPermissions: Math.max(totalPermissions, allScopes.size),
        scopeVariance,
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

    console.log(`[PERF] Transformation completed in ${Date.now() - transformStart}ms`);

    // Cache the results
    if (!includeUsers) {
      setCachedData(cacheKey, transformedApplications);
    }

    const totalTime = Date.now() - startTime;
    console.log(`[PERF] Total response time: ${totalTime}ms for ${transformedApplications.length} applications`);

    // Calculate proper hasMore logic
    const hasMore = applications.length === limit; // If we got exactly the limit, there might be more
    const totalRecords = totalCount || 0;
    
    return NextResponse.json({
      applications: transformedApplications,
      fromCache: false,
      responseTime: totalTime,
      metadata: {
        page,
        limit,
        count: transformedApplications.length,
        totalRecords,
        hasMore,
        deduplicated: deduplicate
      }
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[PERF] Error in applications-v2 API (${totalTime}ms):`, error);
    return NextResponse.json({ 
      error: 'Internal server error',
      responseTime: totalTime
    }, { status: 500 });
  }
}

// PATCH and POST methods - reuse from original
export async function PATCH(request: Request) {
  try {
    const { id, managementStatus, ownerEmail, notes } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Application ID is required' }, { status: 400 });
    }

    const updateData: any = {};
    
    if (managementStatus) {
      if (!['Managed', 'Unmanaged', 'Newly discovered', 'Needs review'].includes(managementStatus)) {
        return NextResponse.json({ error: 'Invalid management status' }, { status: 400 });
      }
      updateData.management_status = managementStatus;
    }
    
    if (ownerEmail !== undefined) {
      updateData.owner_email = ownerEmail;
    }
    
    if (notes !== undefined) {
      updateData.notes = notes;
    }
    
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

    // Clear cache for all related entries
    const keysToDelete = Array.from(APP_CACHE.keys()).filter(key => key.includes('apps_'));
    keysToDelete.forEach(key => APP_CACHE.delete(key));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating application:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 