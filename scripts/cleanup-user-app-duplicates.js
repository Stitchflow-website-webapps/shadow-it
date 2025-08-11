#!/usr/bin/env node

/**
 * General script to clean up duplicate user_applications for any organization
 * Usage:
 *   node scripts/cleanup-user-app-duplicates.js --org-id <org-id>
 *   node scripts/cleanup-user-app-duplicates.js --domain <domain>
 *   node scripts/cleanup-user-app-duplicates.js --check-all
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org-id' && i + 1 < args.length) {
      options.orgId = args[i + 1];
      i++;
    } else if (args[i] === '--domain' && i + 1 < args.length) {
      options.domain = args[i + 1];
      i++;
    } else if (args[i] === '--check-all') {
      options.checkAll = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Usage: node scripts/cleanup-user-app-duplicates.js [options]

Options:
  --org-id <uuid>     Clean up duplicates for specific organization ID
  --domain <domain>   Clean up duplicates for organization with specific domain
  --check-all         Check all organizations for duplicates (no cleanup)
  --help, -h          Show this help message

Examples:
  # Clean up Motiv Health specifically
  node scripts/cleanup-user-app-duplicates.js --org-id 74a6e8af-67f5-4cc3-b8e7-74ed3939f343
  
  # Clean up by domain
  node scripts/cleanup-user-app-duplicates.js --domain motivhealth.com
  
  # Check all organizations for duplicates
  node scripts/cleanup-user-app-duplicates.js --check-all
`);
}

async function findOrgByDomain(supabase, domain) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, domain')
    .eq('domain', domain)
    .single();
    
  if (error) {
    throw new Error(`Could not find organization with domain ${domain}: ${error.message}`);
  }
  
  return data;
}

async function checkAllOrganizations(supabase) {
  console.log('🔍 Checking all organizations for duplicates...\n');
  
  // Get all organizations
  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, domain');
    
  if (orgError) {
    console.error('❌ Error fetching organizations:', orgError);
    return;
  }
  
  const orgStats = [];
  
  // Check each organization for duplicates
  for (const org of orgs) {
    const { data: userApps, error: userAppsError } = await supabase
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        applications!inner(organization_id),
        users!inner(organization_id)
      `)
      .eq('applications.organization_id', org.id)
      .eq('users.organization_id', org.id);
      
    if (userAppsError || !userApps || userApps.length === 0) {
      continue;
    }
    
    const totalUserApps = userApps.length;
    const uniqueCombinations = new Set(userApps.map(ua => `${ua.user_id}-${ua.application_id}`)).size;
    const duplicateCount = totalUserApps - uniqueCombinations;
    
    if (duplicateCount > 0) {
      orgStats.push({
        organization_id: org.id,
        organization_name: org.name,
        domain: org.domain,
        total_user_apps: totalUserApps,
        unique_combinations: uniqueCombinations,
        duplicate_count: duplicateCount
      });
    }
  }
  
  if (orgStats.length === 0) {
    console.log('✅ No organizations with duplicates found!');
    return;
  }
  
  console.log(`Found ${orgStats.length} organizations with duplicates:\n`);
  console.log('Organization'.padEnd(30) + 'Domain'.padEnd(25) + 'Total'.padEnd(8) + 'Unique'.padEnd(8) + 'Duplicates');
  console.log('-'.repeat(80));
  
  orgStats.forEach(org => {
    console.log(
      (org.organization_name || 'Unknown').padEnd(30) +
      (org.domain || 'Unknown').padEnd(25) +
      org.total_user_apps.toString().padEnd(8) +
      org.unique_combinations.toString().padEnd(8) +
      org.duplicate_count.toString()
    );
  });
  
  console.log('\nTo clean up a specific organization, run:');
  console.log('node scripts/cleanup-user-app-duplicates.js --org-id <org-id>');
}

async function cleanupOrganization(supabase, orgId, orgInfo = null) {
  console.log('🔍 Starting cleanup...');
  if (orgInfo) {
    console.log(`Organization: ${orgInfo.name} (${orgInfo.domain})`);
  }
  console.log(`Organization ID: ${orgId}\n`);

  try {
    // Step 1: Check current state
    console.log('📊 Checking current state...');
    
    const { data: beforeStats, error: beforeError } = await supabase
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        applications!inner(organization_id),
        users!inner(organization_id)
      `)
      .eq('applications.organization_id', orgId)
      .eq('users.organization_id', orgId);

    if (beforeError) {
      console.error('❌ Error checking current state:', beforeError);
      return;
    }

    const totalRecords = beforeStats.length;
    const uniqueCombinations = new Set(beforeStats.map(r => `${r.user_id}-${r.application_id}`)).size;
    const duplicates = totalRecords - uniqueCombinations;

    console.log(`📈 Total user_applications: ${totalRecords}`);
    console.log(`🎯 Unique combinations: ${uniqueCombinations}`);
    console.log(`🔄 Duplicates found: ${duplicates}`);

    if (duplicates === 0) {
      console.log('✅ No duplicates found! Nothing to clean up.');
      return;
    }

    // Step 2: Execute cleanup using the existing function
    console.log('\n🧹 Executing cleanup...');
    const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
      'remove_duplicate_user_applications', 
      { org_id: orgId }
    );

    if (cleanupError) {
      console.error('❌ Error during cleanup:', cleanupError);
      return;
    }

    console.log(`✅ Cleanup completed! Removed ${cleanupResult} duplicate records.`);

    // Step 3: Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    const { data: afterStats, error: afterError } = await supabase
      .from('user_applications')
      .select(`
        id,
        user_id,
        application_id,
        applications!inner(organization_id),
        users!inner(organization_id)
      `)
      .eq('applications.organization_id', orgId)
      .eq('users.organization_id', orgId);

    if (afterError) {
      console.error('❌ Error verifying cleanup:', afterError);
      return;
    }

    const finalTotal = afterStats.length;
    const finalUnique = new Set(afterStats.map(r => `${r.user_id}-${r.application_id}`)).size;
    const remainingDuplicates = finalTotal - finalUnique;

    console.log(`📈 Final total user_applications: ${finalTotal}`);
    console.log(`🎯 Final unique combinations: ${finalUnique}`);
    console.log(`🔄 Remaining duplicates: ${remainingDuplicates}`);

    if (remainingDuplicates === 0) {
      console.log('🎉 SUCCESS: All duplicates have been removed!');
    } else {
      console.log('⚠️  WARNING: Some duplicates may still remain.');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    return;
  }
  
  if (!options.orgId && !options.domain && !options.checkAll) {
    console.error('❌ Error: You must specify either --org-id, --domain, or --check-all');
    showHelp();
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    if (options.checkAll) {
      await checkAllOrganizations(supabase);
    } else {
      let orgId = options.orgId;
      let orgInfo = null;
      
      if (options.domain) {
        orgInfo = await findOrgByDomain(supabase, options.domain);
        orgId = orgInfo.id;
      }
      
      await cleanupOrganization(supabase, orgId, orgInfo);
    }
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
