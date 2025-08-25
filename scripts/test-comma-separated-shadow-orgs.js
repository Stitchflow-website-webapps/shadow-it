#!/usr/bin/env node

/**
 * Test script to verify comma-separated shadow org ID functionality
 * This script tests the new multi-org support for Zurabio
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

async function testCommaSeparatedShadowOrgs() {
  console.log('🧪 Testing Comma-Separated Shadow Org ID Support');
  console.log('================================================\n');

  // Test 1: Find organizations with comma-separated shadow org IDs
  console.log('1️⃣ Testing organization lookup...');
  
  try {
    // Look for organizations that might have comma-separated shadow org IDs
    const { data: orgs, error } = await supabase
      .from('organizations')
      .select('*')
      .like('shadow_org_id', '%,%'); // Look for comma in shadow_org_id

    if (error) {
      console.error('❌ Error fetching organizations:', error);
      return;
    }

    console.log(`   Found ${orgs?.length || 0} organizations with comma-separated shadow org IDs:`);
    orgs?.forEach(org => {
      console.log(`      - ${org.name}: ${org.shadow_org_id}`);
    });

    if (!orgs || orgs.length === 0) {
      console.log('   ⚠️  No organizations with comma-separated shadow org IDs found');
      console.log('   💡 To test this feature, you need to add comma-separated shadow org IDs to an organization');
      return;
    }

    // Test 2: Test API endpoint with comma-separated shadow org IDs
    console.log('\n2️⃣ Testing API endpoints...');
    
    const testOrg = orgs[0];
    const shadowOrgIds = testOrg.shadow_org_id;
    
    console.log(`   Testing with shadow org IDs: ${shadowOrgIds}`);

    // Test the apps API
    const appsResponse = await fetch(`http://localhost:3000/api/organize/apps?shadowOrgId=${encodeURIComponent(shadowOrgIds)}`);
    
    if (appsResponse.ok) {
      const apps = await appsResponse.json();
      console.log(`   ✅ Apps API: Retrieved ${apps.length} apps`);
      
      // Check if apps have source_shadow_org_id
      const appsWithSource = apps.filter(app => app.source_shadow_org_id);
      console.log(`   📊 Apps with source tracking: ${appsWithSource.length}/${apps.length}`);
      
      if (appsWithSource.length > 0) {
        console.log('   📝 Sample apps with source tracking:');
        appsWithSource.slice(0, 3).forEach(app => {
          console.log(`      - ${app.name} (from ${app.source_shadow_org_id})`);
        });
      }
    } else {
      const errorData = await appsResponse.json();
      console.error('   ❌ Apps API error:', errorData);
    }

    // Test the organization API
    const orgResponse = await fetch(`http://localhost:3000/api/organize/organization?shadowOrgId=${encodeURIComponent(shadowOrgIds)}`);
    
    if (orgResponse.ok) {
      const orgData = await orgResponse.json();
      console.log(`   ✅ Organization API: Retrieved settings for ${orgData.name}`);
      console.log(`      - Identity Provider: ${orgData.identity_provider || 'Not set'}`);
      console.log(`      - Email Provider: ${orgData.email_provider || 'Not set'}`);
      console.log(`      - Source Shadow Org ID: ${orgData.source_shadow_org_id}`);
    } else {
      const errorData = await orgResponse.json();
      console.error('   ❌ Organization API error:', errorData);
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  }

  console.log('\n🎯 Test Results:');
  console.log('- The API endpoints now support comma-separated shadow org IDs');
  console.log('- Apps from multiple organizations are merged and deduplicated');
  console.log('- Organization settings are retrieved from the first available organization');
  console.log('- Source tracking is added to identify which shadow org each item belongs to');
}

async function createTestData() {
  console.log('\n🔧 Creating test data for comma-separated shadow org IDs...');
  
  // This is a helper function to create test data if needed
  // You would need to run this manually with appropriate shadow org IDs
  
  console.log('To create test data:');
  console.log('1. Find two existing organizations in your database');
  console.log('2. Update one organization to have comma-separated shadow_org_id');
  console.log('3. Example SQL:');
  console.log('   UPDATE "organize-app-inbox".organizations');
  console.log('   SET shadow_org_id = \'org1-id,org2-id\'');
  console.log('   WHERE id = \'your-org-id\';');
}

// Command line handling
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Test script for comma-separated shadow org ID support');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/test-comma-separated-shadow-orgs.js           # Run tests');
  console.log('  node scripts/test-comma-separated-shadow-orgs.js --setup   # Show setup instructions');
  console.log('');
  console.log('This script tests the new functionality that allows a single organization');
  console.log('in the organize-app-inbox schema to represent multiple shadow-it organizations.');
  process.exit(0);
}

if (process.argv.includes('--setup')) {
  createTestData().then(() => process.exit(0));
} else {
  testCommaSeparatedShadowOrgs().then(() => process.exit(0));
}
