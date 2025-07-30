import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel, determineRiskReason } from '@/lib/risk-assessment';

// Cache for user details (shorter TTL since this is more dynamic)
const USER_CACHE = new Map<string, { data: any[], timestamp: number }>();
const USER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache for user data

// Types
type UserApplicationDetail = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  created_at: string;
  scopes: string[];
  riskLevel: string;
  riskReason: string;
  appId: string;
  scopesMessage?: string;
};

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

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    const appName = searchParams.get('appName');
    const orgId = searchParams.get('orgId');

    if (!appId && !appName) {
      return NextResponse.json({ error: 'Application ID or name is required' }, { status: 400 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

         console.log(`[PERF] Loading user details for app: ${appName || appId || 'unknown'}`);

         // Check cache first
     const cacheKey = `users_${appId || appName || 'unknown'}_${orgId}`;
     const cached = USER_CACHE.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL) {
      console.log(`[PERF] Cache hit for user details in ${Date.now() - startTime}ms`);
      return NextResponse.json({
        users: cached.data,
        fromCache: true,
        responseTime: Date.now() - startTime
      });
    }

    // Query to get all applications with this name (handle duplicates)
    let applications;
    if (appId) {
      const { data, error } = await supabaseAdmin
        .from('applications')
        .select('id, name, microsoft_app_id')
        .eq('id', appId)
        .eq('organization_id', orgId);
      
      if (error) throw error;
      applications = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('applications')
        .select('id, name, microsoft_app_id')
        .eq('name', appName)
        .eq('organization_id', orgId);
      
      if (error) throw error;
      applications = data;
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({ 
        users: [], 
        message: 'Application not found',
        responseTime: Date.now() - startTime
      });
    }

    // Get all app IDs for this application name
    const appIds = applications.map(app => app.id);
    const isMicrosoftApp = applications.some(app => app.microsoft_app_id);

    console.log(`[PERF] Found ${applications.length} app instances, fetching users...`);

    // OPTIMIZED QUERY: Get user applications with user details
    const queryStart = Date.now();
    const { data: userApplications, error: userError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        scopes,
        user:users!inner (
          id,
          name,
          email,
          role,
          department,
          created_at
        ),
        application:applications!inner (
          id,
          name
        )
      `)
      .in('application_id', appIds);

    if (userError) {
      throw userError;
    }

    console.log(`[PERF] User applications query completed in ${Date.now() - queryStart}ms, found ${userApplications?.length || 0} records`);

    if (!userApplications || userApplications.length === 0) {
      return NextResponse.json({ 
        users: [], 
        message: 'No users found for this application',
        responseTime: Date.now() - startTime
      });
    }

    // Deduplicate users (same user might appear multiple times due to app duplicates)
    const processStart = Date.now();
    const uniqueUsers = new Map<string, any>();
    const userScopesMap = new Map<string, Set<string>>();

    userApplications.forEach((ua: any) => {
      const userId = ua.user.id;
      if (!uniqueUsers.has(userId)) {
        uniqueUsers.set(userId, ua.user);
        userScopesMap.set(userId, new Set());
      }
      
      // Combine scopes for this user across all app instances
      (ua.scopes || []).forEach((scope: string) => {
        userScopesMap.get(userId)!.add(scope);
      });
    });

    // Transform to final format
    const transformedUsers: UserApplicationDetail[] = Array.from(uniqueUsers.entries()).map(([userId, user]) => {
      const userScopes = Array.from(userScopesMap.get(userId) || []);
      
      return {
        id: user.id,
        appId: applications[0].id, // Use the primary app ID
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        scopes: userScopes,
        scopesMessage: isMicrosoftApp ? "Scope details not available for Microsoft applications" : undefined,
        created_at: user.created_at,
        riskLevel: determineRiskLevel(userScopes),
        riskReason: determineRiskReason(userScopes)
      };
    });

    // Calculate scope variance for the application
    const scopeVariance = calculateScopeVariance(transformedUsers);

    console.log(`[PERF] User processing completed in ${Date.now() - processStart}ms`);

    // Cache the results
    USER_CACHE.set(cacheKey, {
      data: transformedUsers,
      timestamp: Date.now()
    });

    // Clean up old cache entries
    if (USER_CACHE.size > 50) {
      const oldestKey = USER_CACHE.keys().next().value;
      if (oldestKey) {
        USER_CACHE.delete(oldestKey);
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[PERF] Total user details response time: ${totalTime}ms for ${transformedUsers.length} users`);

    return NextResponse.json({
      users: transformedUsers,
      scopeVariance,
      fromCache: false,
      responseTime: totalTime,
      metadata: {
        userCount: transformedUsers.length,
        appInstanceCount: applications.length,
        isMicrosoftApp
      }
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[PERF] Error in application-users API (${totalTime}ms):`, error);
    return NextResponse.json({ 
      error: 'Internal server error',
      responseTime: totalTime
    }, { status: 500 });
  }
} 