#!/usr/bin/env node

/**
 * Script to clean up incorrect Microsoft user-app relationships for Zurobio
 * This fixes the issue where admin consent was incorrectly creating user-app relationships
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function findZurobioOrganization() {
  console.log('🔍 Searching for Zurobio organization...');
  
  // Search by domain patterns
  const searchTerms = ['zurobio', 'zuro-bio', 'zurobio.com'];
  
  for (const term of searchTerms) {
    console.log(`   Searching for: ${term}`);
    
    const { data: orgs, error } = await supabase
      .from('organizations')
      .select('*')
      .or(`name.ilike.%${term}%,domain.ilike.%${term}%`);
    
    if (error) {
      console.error(`   Error searching for ${term}:`, error);
      continue;
    }
    
    if (orgs && orgs.length > 0) {
      console.log(`   ✅ Found ${orgs.length} organization(s):`);
      orgs.forEach(org => {
        console.log(`      - ${org.name} (${org.domain}) - ID: ${org.id}`);
      });
      return orgs;
    }
  }
  
  return null;
}

async function analyzeOrganization(orgId) {
  console.log(`\n📊 Analyzing organization: ${orgId}`);
  
  // Get organization details
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();
    
  if (orgError) {
    console.error('❌ Error fetching organization:', orgError);
    return null;
  }
  
  console.log(`✅ Organization: ${org.name} (${org.domain})`);
  console.log(`   Auth Provider: ${org.auth_provider}`);
  console.log(`   Created: ${org.created_at}`);
  
  // Get user count
  const { count: userCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);
    
  console.log(`   Total Users: ${userCount}`);
  
  // Get application count and details
  const { data: apps, error: appsError } = await supabase
    .from('applications')
    .select('id, name, user_count, microsoft_app_id')
    .eq('organization_id', orgId)
    .order('user_count', { ascending: false });
    
  if (appsError) {
    console.error('❌ Error fetching applications:', appsError);
    return null;
  }
  
  console.log(`   Total Applications: ${apps?.length || 0}`);
  
  if (apps && apps.length > 0) {
    console.log(`\n📱 Top applications by user count:`);
    apps.slice(0, 10).forEach(app => {
      console.log(`      ${app.name}: ${app.user_count} users`);
    });
    
    // Look for suspicious patterns (apps with user count close to total user count)
    const suspiciousApps = apps.filter(app => 
      app.user_count && userCount && 
      app.user_count > (userCount * 0.8) // More than 80% of users
    );
    
    if (suspiciousApps.length > 0) {
      console.log(`\n⚠️  Suspicious applications (high user count):`);
      suspiciousApps.forEach(app => {
        console.log(`      ${app.name}: ${app.user_count}/${userCount} users (${Math.round(app.user_count/userCount*100)}%)`);
      });
    }
  }
  
  // Check for Microsoft sync records
  const { data: syncRecords } = await supabase
    .from('sync_status')
    .select('*')
    .eq('organization_id', orgId)
    .eq('provider', 'microsoft')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (syncRecords && syncRecords.length > 0) {
    console.log(`\n🔄 Recent Microsoft sync records:`);
    syncRecords.forEach(sync => {
      console.log(`      ${sync.created_at}: ${sync.status} - ${sync.message}`);
    });
  }
  
  return org;
}

async function runCleanupAnalysis(orgId, dryRun = true) {
  console.log(`\n🧹 Running cleanup analysis for organization: ${orgId}`);
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (analysis only)' : 'LIVE (will make changes)'}`);
  
  try {
    const response = await fetch('http://localhost:3000/api/admin/cleanup-microsoft-user-apps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: orgId,
        dry_run: dryRun
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Cleanup API error:', errorData);
      return null;
    }
    
    const result = await response.json();
    
    console.log(`\n📊 Cleanup Analysis Results:`);
    console.log(`   Total relationships: ${result.analysis.totalRelationships}`);
    console.log(`   Relationships to keep: ${result.analysis.relationshipsToKeep}`);
    console.log(`   Relationships to remove: ${result.analysis.relationshipsToRemove}`);
    console.log(`   Users with actual assignments: ${result.analysis.actualAssignments}`);
    
    if (result.applicationBreakdown) {
      console.log(`\n📱 Application breakdown:`);
      Object.entries(result.applicationBreakdown).forEach(([appName, counts]) => {
        console.log(`   ${appName}:`);
        console.log(`      Keep: ${counts.keep} users`);
        console.log(`      Remove: ${counts.remove} users`);
      });
    }
    
    if (result.details?.relationshipsToRemove?.length > 0) {
      console.log(`\n🗑️  Sample relationships to remove:`);
      result.details.relationshipsToRemove.slice(0, 10).forEach(rel => {
        console.log(`      ${rel.userEmail} -> ${rel.appName}`);
      });
      
      if (result.details.relationshipsToRemove.length > 10) {
        console.log(`      ... and ${result.details.relationshipsToRemove.length - 10} more`);
      }
    }
    
    if (!dryRun && result.actions.removedRelationships > 0) {
      console.log(`\n✅ Successfully removed ${result.actions.removedRelationships} incorrect relationships`);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error calling cleanup API:', error);
    return null;
  }
}

async function main() {
  console.log('🔧 Zurobio Microsoft Data Cleanup Tool');
  console.log('=====================================\n');
  
  // Step 1: Find Zurobio organization
  const organizations = await findZurobioOrganization();
  
  if (!organizations || organizations.length === 0) {
    console.log('❌ No Zurobio organization found');
    console.log('\n💡 Try searching manually in the database:');
    console.log('   SELECT * FROM organizations WHERE name ILIKE \'%zurobio%\' OR domain ILIKE \'%zurobio%\';');
    process.exit(1);
  }
  
  // If multiple organizations found, analyze all
  for (const org of organizations) {
    await analyzeOrganization(org.id);
    
    // Ask user if they want to run cleanup analysis
    if (process.argv.includes('--analyze') || process.argv.includes('--cleanup')) {
      const dryRun = !process.argv.includes('--execute');
      await runCleanupAnalysis(org.id, dryRun);
    }
  }
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Run analysis: node scripts/cleanup-zurobio-microsoft-data.js --analyze');
  console.log('2. Execute cleanup: node scripts/cleanup-zurobio-microsoft-data.js --cleanup --execute');
  console.log('\n⚠️  Always run analysis first before executing cleanup!');
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Zurobio Microsoft Data Cleanup Tool');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/cleanup-zurobio-microsoft-data.js                    # Find organization');
  console.log('  node scripts/cleanup-zurobio-microsoft-data.js --analyze         # Run analysis (dry run)');
  console.log('  node scripts/cleanup-zurobio-microsoft-data.js --cleanup --execute # Execute cleanup');
  console.log('');
  console.log('Options:');
  console.log('  --analyze    Run cleanup analysis (dry run)');
  console.log('  --cleanup    Run cleanup process');
  console.log('  --execute    Actually execute changes (use with --cleanup)');
  console.log('  --help, -h   Show this help message');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Script error:', error);
  process.exit(1);
});
