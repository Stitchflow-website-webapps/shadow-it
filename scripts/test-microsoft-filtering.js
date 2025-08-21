#!/usr/bin/env node

/**
 * Script to test Microsoft user filtering locally
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

async function findTestOrganization() {
  console.log('🔍 Finding organizations with Microsoft sync...');
  
  const { data: orgs, error } = await supabase
    .from('sync_status')
    .select(`
      organization_id,
      organizations!inner(name, domain)
    `)
    .eq('provider', 'microsoft')
    .not('refresh_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('❌ Error fetching organizations:', error);
    return null;
  }
  
  if (!orgs || orgs.length === 0) {
    console.log('❌ No organizations found with Microsoft sync');
    return null;
  }
  
  console.log(`✅ Found ${orgs.length} organization(s) with Microsoft sync:`);
  orgs.forEach((org, index) => {
    const orgData = org.organizations;
    console.log(`   ${index + 1}. ${orgData.name} (${orgData.domain}) - ID: ${org.organization_id}`);
  });
  
  return orgs;
}

async function testFiltering(orgId) {
  console.log(`\n🧪 Testing Microsoft user filtering for organization: ${orgId}`);
  
  const baseUrl = 'http://localhost:3000';
  
  try {
    // Test 1: Default filtering (members only)
    console.log('\n📊 Test 1: Default filtering (members only)');
    const response1 = await fetch(`${baseUrl}/api/test-microsoft-filtering?org_id=${orgId}`);
    
    if (!response1.ok) {
      const errorData = await response1.json();
      console.error('❌ API Error:', errorData);
      return;
    }
    
    const results = await response1.json();
    
    console.log('\n📈 Results Summary:');
    console.log(`   Tenant ID: ${results.tenantId}`);
    console.log(`   Organization ID: ${results.organizationId}`);
    
    console.log('\n📊 User Count Comparison:');
    console.log(`   Members Only: ${results.testResults.membersOnly.count} users`);
    console.log(`   With Guests: ${results.testResults.withGuests.count} users`);
    console.log(`   All Users: ${results.testResults.allUsers.count} users`);
    
    console.log('\n📋 Member Breakdown (Default):');
    Object.entries(results.testResults.membersOnly.breakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} users`);
    });
    
    console.log('\n📋 With Guests Breakdown:');
    Object.entries(results.testResults.withGuests.breakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} users`);
    });
    
    console.log('\n📋 All Users Breakdown:');
    Object.entries(results.testResults.allUsers.breakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} users`);
    });
    
    console.log('\n📉 Filtering Impact:');
    console.log(`   ${results.summary.reductionFromFiltering.allUsersToMembers}`);
    console.log(`   ${results.summary.reductionFromFiltering.withGuestsToMembers}`);
    
    if (results.testResults.membersOnly.sampleUsers.length > 0) {
      console.log('\n👤 Sample Users (Members Only):');
      results.testResults.membersOnly.sampleUsers.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.email} (${user.userType}, ${user.accountEnabled ? 'Enabled' : 'Disabled'})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error testing filtering:', error);
  }
}

async function main() {
  console.log('🧪 Microsoft User Filtering Test Tool');
  console.log('====================================\n');
  
  // Check if server is running
  try {
    const response = await fetch('http://localhost:3000/api/test-microsoft-filtering?org_id=test');
    // We expect a 400 error for missing org, but at least the server is running
  } catch (error) {
    console.error('❌ Development server is not running!');
    console.log('\n💡 Start the server first:');
    console.log('   npm run dev');
    console.log('   # or');
    console.log('   yarn dev');
    process.exit(1);
  }
  
  // Find organizations to test
  const organizations = await findTestOrganization();
  
  if (!organizations || organizations.length === 0) {
    console.log('\n💡 No organizations found with Microsoft sync.');
    console.log('   Make sure you have organizations that have completed Microsoft sync.');
    process.exit(1);
  }
  
  // Test with the first organization (or you can modify to test multiple)
  const testOrgId = organizations[0].organization_id;
  await testFiltering(testOrgId);
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Review the user count differences above');
  console.log('2. Verify that "Members Only" gives you the expected count');
  console.log('3. Check that guest users are properly excluded');
  console.log('4. Test with different organizations if needed');
  
  console.log('\n⚙️ Environment Variable Testing:');
  console.log('   MICROSOFT_INCLUDE_GUESTS=' + (process.env.MICROSOFT_INCLUDE_GUESTS || 'false'));
  console.log('   MICROSOFT_INCLUDE_DISABLED=' + (process.env.MICROSOFT_INCLUDE_DISABLED || 'false'));
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Microsoft User Filtering Test Tool');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/test-microsoft-filtering.js');
  console.log('');
  console.log('Prerequisites:');
  console.log('  1. Development server running (npm run dev)');
  console.log('  2. Environment variables configured');
  console.log('  3. Organization with Microsoft sync credentials');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Script error:', error);
  process.exit(1);
});
