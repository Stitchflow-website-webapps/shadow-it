import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300; // 5 minutes timeout for fast cleanup
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { organization_id, dry_run = true } = await request.json();
    
    if (!organization_id) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    console.log(`🚀 Starting FAST Microsoft user-app cleanup for organization: ${organization_id}`);
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

    // Step 2: Get current user-app relationships from database
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

    // Step 3: FAST ANALYSIS - Identify suspicious patterns without Microsoft API calls
    console.log(`⚡ Running fast analysis to identify suspicious patterns...`);
    
    // Get user count for this organization
    const { count: totalUsers } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id);

    console.log(`👥 Total users in organization: ${totalUsers}`);

    // Group relationships by application
    const appRelationshipCounts = new Map<string, {
      appId: string;
      appName: string;
      userCount: number;
      relationships: any[];
    }>();

    for (const rel of currentRelationships || []) {
      const appId = (rel.applications as any).microsoft_app_id;
      const appName = (rel.applications as any).name;
      
      if (!appRelationshipCounts.has(appId)) {
        appRelationshipCounts.set(appId, {
          appId,
          appName,
          userCount: 0,
          relationships: []
        });
      }
      
      const appData = appRelationshipCounts.get(appId)!;
      appData.userCount++;
      appData.relationships.push(rel);
    }

    // Step 4: Identify suspicious applications (likely affected by admin consent issue)
    const suspiciousApps: any[] = [];
    const normalApps: any[] = [];
    
    const suspiciousThreshold = Math.max(10, Math.floor(totalUsers * 0.8)); // Apps with >80% of users or >10 users
    
    for (const [appId, appData] of appRelationshipCounts) {
      if (appData.userCount >= suspiciousThreshold) {
        suspiciousApps.push(appData);
        console.log(`🚨 SUSPICIOUS: ${appData.appName} has ${appData.userCount}/${totalUsers} users (${Math.round(appData.userCount/totalUsers*100)}%)`);
      } else {
        normalApps.push(appData);
        console.log(`✅ NORMAL: ${appData.appName} has ${appData.userCount} users`);
      }
    }

    // Step 5: Calculate cleanup impact
    const relationshipsToRemove = suspiciousApps.flatMap(app => app.relationships);
    const relationshipsToKeep = normalApps.flatMap(app => app.relationships);

    console.log(`📊 Fast Analysis Complete:`);
    console.log(`   🚨 Suspicious apps (likely admin consent issue): ${suspiciousApps.length}`);
    console.log(`   ✅ Normal apps: ${normalApps.length}`);
    console.log(`   ❌ Relationships to remove: ${relationshipsToRemove.length}`);
    console.log(`   ✅ Relationships to keep: ${relationshipsToKeep.length}`);

    // Step 6: Show breakdown
    console.log(`\n📋 Suspicious Applications Breakdown:`);
    for (const app of suspiciousApps) {
      console.log(`   ${app.appName}: ${app.userCount} users (${Math.round(app.userCount/totalUsers*100)}% of org)`);
    }

    // Step 7: Execute cleanup if not dry run
    let removedCount = 0;
    if (!dry_run && relationshipsToRemove.length > 0) {
      console.log(`🗑️ Removing ${relationshipsToRemove.length} suspicious relationships...`);
      
      // Remove in batches
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
          console.log(`✅ Removed batch ${i / batchSize + 1}/${Math.ceil(relationshipsToRemove.length / batchSize)} (${batch.length} relationships)`);
        }
      }

      // Update application user counts
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
        method: 'fast_pattern_analysis',
        totalUsers: totalUsers,
        totalRelationships: currentRelationships?.length || 0,
        suspiciousApps: suspiciousApps.length,
        normalApps: normalApps.length,
        relationshipsToKeep: relationshipsToKeep.length,
        relationshipsToRemove: relationshipsToRemove.length,
        suspiciousThreshold: suspiciousThreshold
      },
      suspiciousApplications: suspiciousApps.map(app => ({
        name: app.appName,
        userCount: app.userCount,
        percentageOfOrg: Math.round(app.userCount/totalUsers*100)
      })),
      normalApplications: normalApps.map(app => ({
        name: app.appName,
        userCount: app.userCount,
        percentageOfOrg: Math.round(app.userCount/totalUsers*100)
      })),
      actions: {
        dryRun: dry_run,
        removedRelationships: removedCount
      },
      recommendation: suspiciousApps.length > 0 
        ? `Found ${suspiciousApps.length} apps with suspicious user counts. These likely have admin consent issues.`
        : 'No suspicious patterns found. Your user-app relationships appear to be legitimate.'
    };

    console.log(`🎉 Fast cleanup ${dry_run ? 'analysis' : 'execution'} completed in seconds!`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ Fast cleanup error:', error);
    return NextResponse.json({ 
      error: 'Fast cleanup failed', 
      details: (error as Error).message 
    }, { status: 500 });
  }
}
