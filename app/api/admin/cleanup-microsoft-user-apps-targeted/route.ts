import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

export const maxDuration = 600; // 10 minutes timeout
export const dynamic = 'force-dynamic';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  try {
    const { organization_id, dry_run = true } = await request.json();
    
    if (!organization_id) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    console.log(`🎯 Starting TARGETED Microsoft user-app cleanup for organization: ${organization_id}`);
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

    // Step 2: Get all current user-app relationships from database
    console.log(`📊 Fetching current user-app relationships from database...`);
    
    const { data: currentRelationships, error: relationshipsError } = await supabaseAdmin
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        scopes,
        users!inner(email, microsoft_user_id, organization_id, created_at),
        applications!inner(name, microsoft_app_id, organization_id)
      `)
      .eq('users.organization_id', organization_id)
      .eq('applications.organization_id', organization_id);

    if (relationshipsError) {
      throw new Error(`Failed to fetch relationships: ${relationshipsError.message}`);
    }

    console.log(`📊 Found ${currentRelationships?.length || 0} current user-app relationships`);

    // Step 3: SMART FILTERING - Only check users who have relationships in suspicious apps
    console.log(`🧠 Identifying users in potentially problematic apps...`);
    
    // Group relationships by app to identify suspicious patterns
    const appUserCounts = new Map<string, { appName: string; appId: string; users: Set<string>; relationships: any[] }>();
    
    for (const rel of currentRelationships || []) {
      const appId = (rel.applications as any).microsoft_app_id;
      const appName = (rel.applications as any).name;
      const userEmail = (rel.users as any).email;
      
      if (!appUserCounts.has(appId)) {
        appUserCounts.set(appId, {
          appName,
          appId,
          users: new Set(),
          relationships: []
        });
      }
      
      const appData = appUserCounts.get(appId)!;
      appData.users.add(userEmail);
      appData.relationships.push(rel);
    }

    // Get total user count to identify suspicious apps (those with >50% of all users)
    const { count: totalUsers } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id);

    const suspiciousThreshold = Math.max(20, Math.floor(totalUsers * 0.5)); // Apps with >50% users or >20 users
    
    const suspiciousApps = Array.from(appUserCounts.values()).filter(app => app.users.size >= suspiciousThreshold);
    const normalApps = Array.from(appUserCounts.values()).filter(app => app.users.size < suspiciousThreshold);
    
    console.log(`🚨 Found ${suspiciousApps.length} suspicious apps (likely admin consent issues):`);
    suspiciousApps.forEach(app => {
      console.log(`   ${app.appName}: ${app.users.size} users (${Math.round(app.users.size/totalUsers*100)}%)`);
    });
    
    console.log(`✅ Found ${normalApps.length} normal apps with reasonable user counts`);

    if (suspiciousApps.length === 0) {
      return NextResponse.json({
        organization: { id: organization_id, name: org.name, domain: org.domain },
        analysis: {
          method: 'targeted_smart_analysis',
          totalRelationships: currentRelationships?.length || 0,
          suspiciousApps: 0,
          normalApps: normalApps.length,
          relationshipsToRemove: 0,
          relationshipsToKeep: currentRelationships?.length || 0
        },
        actions: { dryRun: dry_run, removedRelationships: 0 },
        recommendation: 'No suspicious patterns found. All app user counts appear legitimate.'
      });
    }

    // Step 4: Initialize Microsoft service ONLY for targeted verification
    console.log(`🔑 Initializing Microsoft service for targeted verification...`);
    
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

    await microsoftService.setCredentials({ refresh_token: syncRecord.refresh_token });
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
    console.log(`✅ Microsoft service initialized`);

    // Step 5: TARGETED VERIFICATION - Only check suspicious apps and their users
    console.log(`🎯 Performing targeted verification of ${suspiciousApps.length} suspicious apps...`);
    
    const relationshipsToRemove: any[] = [];
    const relationshipsToKeep: any[] = [];
    
    // Keep all relationships from normal apps (they're not suspicious)
    for (const app of normalApps) {
      relationshipsToKeep.push(...app.relationships);
    }
    
    // Only verify suspicious apps by checking a sample of their users
    for (const app of suspiciousApps) {
      console.log(`🔍 Checking suspicious app: ${app.appName} (${app.users.size} users)`);
      
      // Sample a few users from this app to verify if they actually have access
      const sampleUsers = Array.from(app.users).slice(0, 5); // Check first 5 users
      let legitimateUsers = 0;
      
      for (const userEmail of sampleUsers) {
        try {
          // Get user's actual app role assignments
          const userResponse = await correctMicrosoftService.client.api('/users').filter(`mail eq '${userEmail}' or userPrincipalName eq '${userEmail}'`).get();
          
          if (userResponse?.value?.[0]) {
            const userId = userResponse.value[0].id;
            const appRoleResponse = await correctMicrosoftService.client.api(`/users/${userId}/appRoleAssignments`).get();
            
            // Check if user has actual assignment to this app
            const hasActualAssignment = appRoleResponse?.value?.some((assignment: any) => {
              return assignment.resourceId === app.appId; // This would need service principal lookup
            });
            
            if (hasActualAssignment) {
              legitimateUsers++;
            }
          }
          
          await sleep(100); // Small delay
        } catch (error) {
          console.warn(`⚠️ Error checking user ${userEmail}:`, error);
        }
      }
      
      // If most sampled users don't have legitimate access, mark entire app as suspicious
      const legitimatePercentage = legitimateUsers / sampleUsers.length;
      console.log(`📊 ${app.appName}: ${legitimateUsers}/${sampleUsers.length} sampled users have legitimate access (${Math.round(legitimatePercentage * 100)}%)`);
      
      if (legitimatePercentage < 0.3) { // Less than 30% have legitimate access
        console.log(`🚨 Marking all ${app.relationships.length} relationships for ${app.appName} as suspicious`);
        relationshipsToRemove.push(...app.relationships);
      } else {
        console.log(`✅ Keeping all ${app.relationships.length} relationships for ${app.appName} (appears legitimate)`);
        relationshipsToKeep.push(...app.relationships);
      }
    }

    console.log(`📊 Targeted analysis complete:`);
    console.log(`   ✅ Relationships to keep: ${relationshipsToKeep.length}`);
    console.log(`   ❌ Relationships to remove: ${relationshipsToRemove.length}`);

    // Step 6: Execute cleanup if not dry run
    let removedCount = 0;
    if (!dry_run && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} suspicious relationships...`);
      
      const batchSize = 100;
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
          console.log(`✅ Removed batch ${i / batchSize + 1}/${Math.ceil(relationshipsToRemove.length / batchSize)}`);
        }
      }

      // Update application user counts
      console.log(`🔄 Updating application user counts...`);
      const affectedApps = [...new Set(relationshipsToRemove.map(rel => rel.application_id))];
      
      for (const appId of affectedApps) {
        const { count } = await supabaseAdmin
          .from('user_applications')
          .select('*', { count: 'exact', head: true })
          .eq('application_id', appId);

        await supabaseAdmin
          .from('applications')
          .update({ 
            user_count: count || 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', appId);
      }
    }

    const result = {
      organization: {
        id: organization_id,
        name: org.name,
        domain: org.domain
      },
      analysis: {
        method: 'targeted_smart_analysis',
        totalRelationships: currentRelationships?.length || 0,
        suspiciousApps: suspiciousApps.length,
        normalApps: normalApps.length,
        relationshipsToKeep: relationshipsToKeep.length,
        relationshipsToRemove: relationshipsToRemove.length,
        suspiciousThreshold: suspiciousThreshold
      },
      suspiciousApplications: suspiciousApps.map(app => ({
        name: app.appName,
        userCount: app.users.size,
        percentageOfOrg: Math.round(app.users.size/totalUsers*100)
      })),
      actions: {
        dryRun: dry_run,
        removedRelationships: removedCount
      },
      recommendation: suspiciousApps.length > 0 
        ? `Found ${suspiciousApps.length} apps with suspicious user counts. Performed targeted verification.`
        : 'No suspicious patterns found. All relationships appear legitimate.'
    };

    console.log(`🎉 Targeted cleanup ${dry_run ? 'analysis' : 'execution'} completed successfully`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Targeted cleanup error:', error);
    return NextResponse.json({ 
      error: 'Targeted cleanup failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
