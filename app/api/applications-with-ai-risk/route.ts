import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';
import { determineRiskLevel, determineRiskReason, transformRiskLevel, determineAppRiskReason } from '@/lib/risk-assessment';

// Helper to generate app logo URL from logo.dev
function getAppLogoUrl(appName: string) {
  const domain = appNameToDomain(appName);
  const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
  const fallbackUrl = `https://icon.horse/icon/${domain}`;
  return { primary: logoUrl, fallback: fallbackUrl };
}

function appNameToDomain(appName: string): string {
  const knownDomains: Record<string, string> = {
    'slack': 'slack.com', 'stitchflow': 'stitchflow.io', 'yeshid': 'yeshid.com', 'onelogin': 'onelogin.com',
    'google drive': 'drive.google.com', 'google chrome': 'google.com', 'accessowl': 'accessowl.com',
    'accessowl scanner': 'accessowl.com', 'mode analytics': 'mode.com', 'hubspot': 'hubspot.com',
    'github': 'github.com', 'gmail': 'gmail.com', 'zoom': 'zoom.us', 'notion': 'notion.so',
    'figma': 'figma.com', 'jira': 'atlassian.com', 'confluence': 'atlassian.com', 'asana': 'asana.com',
    'trello': 'trello.com', 'dropbox': 'dropbox.com', 'box': 'box.com', 'microsoft': 'microsoft.com', 'office365': 'office.com'
  };
  const lowerAppName = appName.toLowerCase();
  if (knownDomains[lowerAppName]) return knownDomains[lowerAppName];
  for (const [key, domain] of Object.entries(knownDomains)) {
    if (lowerAppName.includes(key)) return domain;
  }
  const sanitized = lowerAppName.replace(/[^\w\s-]/gi, '').replace(/\s+/g, '');
  return sanitized + '.com';
}

function transformManagementStatus(status: string) {
  const validStatuses = ['Managed', 'Unmanaged', 'Newly discovered', 'Unknown', 'Ignore', 'Not specified'];
  if (validStatuses.includes(status)) return status;
  if (status === 'Needs Review') return 'Not specified';
  return 'Not specified';
}

function calculateScopeVariance(userApplications: any[] | null) {
  if (!userApplications) return { userGroups: 0, scopeGroups: 0 };
  const uniqueScopeSets = new Set(userApplications.map(ua => (ua.scopes || []).sort().join('|')));
  return { userGroups: uniqueScopeSets.size, scopeGroups: Math.min(uniqueScopeSets.size, 5) };
}

export async function GET(request: NextRequest) {
  try {
    const orgId = request.cookies.get('orgId')?.value;
    if (!orgId) {
      return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });
    }

    console.log(`Fetching applications for org: ${orgId}`);
    const startTime = Date.now();

    // Fetch applications with a reasonable limit and timeout
    const { data: applications, error } = await supabaseAdmin
      .from('applications')
      .select(`*, user_applications:user_applications!inner (scopes, user:users!inner (id, name, email, role, department, created_at))`)
      .eq('organization_id', orgId)
      .limit(5000); // Reduced from 10000 to prevent timeouts

    if (error) {
      console.error('Error fetching applications:', error);
      throw error;
    }
    if (!applications || applications.length === 0) {
      console.log('No applications found');
      return NextResponse.json({ data: [] });
    }

    console.log(`Fetched ${applications.length} applications in ${Date.now() - startTime}ms`);

    // Get unique app names for targeted AI risk score fetching
    const uniqueAppNames = [...new Set(applications.map(app => app.name))];
    console.log(`Found ${uniqueAppNames.length} unique app names`);

    // Only fetch AI risk scores that might match our apps (more targeted query)
    const aiStartTime = Date.now();
    let aiRiskMap = new Map();
    
    try {
      // Fetch only the columns we need and limit results
      const { data: aiRiskScores, error: aiError } = await supabaseAIAdmin
        .from('ai_risk_scores')
        .select('app_id, "Tool Name", "AI-Native", "Average 1", "Average 2", "Average 3", "Average 4", "Average 5"')
        .limit(10000); // Limit AI risk scores to prevent memory issues

      if (aiError) {
        console.warn('Error fetching AI risk scores:', aiError);
        // Continue without AI data rather than failing completely
      } else if (aiRiskScores) {
        aiRiskMap = new Map(
          aiRiskScores.map(score => [score['Tool Name']?.toLowerCase().trim(), score])
        );
        console.log(`Fetched ${aiRiskScores.length} AI risk scores in ${Date.now() - aiStartTime}ms`);
      }
    } catch (aiError) {
      console.warn('Failed to fetch AI risk scores, continuing without AI data:', aiError);
    }

    // Group and deduplicate applications by name
    const appsByName = new Map();
    applications.forEach(app => {
      const appName = app.name;
      if (!appsByName.has(appName)) appsByName.set(appName, []);
      appsByName.get(appName).push(app);
    });

    console.log(`Processing ${appsByName.size} unique applications`);
    const processStartTime = Date.now();

    const transformedApplications = Array.from(appsByName.entries()).map(([appName, appInstances]: [string, any[]]) => {
      const allUserApplications: any[] = [];
      const allScopes = new Set<string>();
      let totalPermissions = 0;
      let highestRiskLevel = 'LOW';
      let latestCreatedAt = '';
      let managementStatus = 'Not specified';
      let ownerEmail = '';
      let notes = '';
      let isMicrosoftApp = false;
      
      appInstances.forEach((app: any) => {
        const validUserApplications: any[] = (app.user_applications || []).filter((ua: any) => ua.user != null && ua.scopes != null);
        allUserApplications.push(...validUserApplications);
        if (app.all_scopes) (app.all_scopes as string[]).forEach((scope: string) => allScopes.add(scope));
        validUserApplications.forEach((ua: any) => (ua.scopes || []).forEach((scope: string) => allScopes.add(scope)));
        const currentRisk = (app.risk_level || 'low').toUpperCase();
        if (currentRisk === 'HIGH') highestRiskLevel = 'HIGH';
        else if (currentRisk === 'MEDIUM' && highestRiskLevel !== 'HIGH') highestRiskLevel = 'MEDIUM';
        totalPermissions = Math.max(totalPermissions, app.total_permissions || 0);
        if (app.created_at > latestCreatedAt) latestCreatedAt = app.created_at;
        if (app.management_status && app.management_status !== 'Not specified') managementStatus = app.management_status;
        if (app.owner_email) ownerEmail = app.owner_email;
        if (app.notes) notes = app.notes;
        if (app.microsoft_app_id) isMicrosoftApp = true;
      });
      
      const uniqueUsers = new Map<string, any>();
      const userScopesMap = new Map<string, Set<string>>();
      allUserApplications.forEach((ua: any) => {
        const userId = ua.user.id;
        if (!uniqueUsers.has(userId)) {
          uniqueUsers.set(userId, ua.user);
          userScopesMap.set(userId, new Set<string>());
        }
        (ua.scopes || []).forEach((scope: string) => userScopesMap.get(userId)!.add(scope));
      });
      
      const baseApp = appInstances[0];
      const logoUrls = getAppLogoUrl(appName);
      const aiRiskData = aiRiskMap.get(appName.toLowerCase().trim()) || null;
      
      return {
        id: baseApp.id,
        name: appName,
        category: baseApp.category || 'Others',
        userCount: uniqueUsers.size,
        users: Array.from(uniqueUsers.entries()).map(([userId, user]: [string, any]) => {
          const userScopes = Array.from(userScopesMap.get(userId) || []) as string[];
          return {
            id: user.id, appId: baseApp.id, name: user.name, email: user.email, scopes: userScopes,
            scopesMessage: isMicrosoftApp ? 'Scope details not available for Microsoft applications' : undefined,
            created_at: user.created_at, riskLevel: determineRiskLevel(userScopes), riskReason: determineRiskReason(userScopes)
          };
        }),
        riskLevel: transformRiskLevel(highestRiskLevel),
        riskReason: determineAppRiskReason(highestRiskLevel, Math.max(totalPermissions, allScopes.size)),
        totalPermissions: Math.max(totalPermissions, allScopes.size),
        scopeVariance: calculateScopeVariance(Array.from(uniqueUsers.values()).map((user: any) => ({ scopes: Array.from(userScopesMap.get(user.id) || []) as string[] }))),
        logoUrl: logoUrls.primary, logoUrlFallback: logoUrls.fallback, created_at: latestCreatedAt || baseApp.created_at,
        managementStatus: transformManagementStatus(managementStatus), ownerEmail: ownerEmail, notes: notes,
        scopes: Array.from(allScopes) as string[], scopesMessage: isMicrosoftApp ? 'Scope details not available for Microsoft applications' : undefined,
        isInstalled: managementStatus === 'MANAGED', isAuthAnonymously: false, provider: isMicrosoftApp ? 'microsoft' : 'google',
        aiRiskData
      };
    });

    const totalTime = Date.now() - startTime;
    console.log(`Processed ${transformedApplications.length} applications in ${Date.now() - processStartTime}ms (total: ${totalTime}ms)`);
    
    return NextResponse.json({ data: transformedApplications });
  } catch (error) {
    console.error('Error in applications-with-ai-risk API:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 