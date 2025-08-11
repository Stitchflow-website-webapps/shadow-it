#!/usr/bin/env node

/**
 * Script to clean up duplicate user_applications for Motiv Health
 * Run with: node scripts/cleanup-motiv-health-duplicates.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const MOTIV_HEALTH_ORG_ID = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

async function main() {
  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('🔍 Starting cleanup for Motiv Health duplicates...');
  console.log(`Organization ID: ${MOTIV_HEALTH_ORG_ID}`);

  try {
    // Step 1: Check current state
    console.log('\n📊 Checking current state...');
    
    // Get all user_applications for this organization using raw SQL
    const { data: userApps, error: beforeError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          ua.id,
          ua.user_id,
          ua.application_id,
          ua.scopes,
          ua.created_at,
          ua.updated_at,
          u.email as user_email,
          a.name as app_name
        FROM shadow_it.user_applications ua
        INNER JOIN shadow_it.applications a ON ua.application_id = a.id
        INNER JOIN shadow_it.users u ON ua.user_id = u.id
        WHERE a.organization_id = '${MOTIV_HEALTH_ORG_ID}'
          AND u.organization_id = '${MOTIV_HEALTH_ORG_ID}'
        ORDER BY u.email, a.name, ua.created_at
      `
    });

    if (beforeError) {
      console.error('❌ Error checking current state:', beforeError);
      return;
    }

    if (!userApps || userApps.length === 0) {
      console.log('✅ No user_applications found for this organization.');
      return;
    }

    // Calculate statistics
    const totalRecords = userApps.length;
    const uniqueCombinations = new Set(userApps.map(ua => `${ua.user_id}-${ua.application_id}`)).size;
    const duplicates = totalRecords - uniqueCombinations;

    console.log(`📈 Total user_applications: ${totalRecords}`);
    console.log(`🎯 Unique combinations: ${uniqueCombinations}`);
    console.log(`🔄 Duplicates found: ${duplicates}`);

    if (duplicates === 0) {
      console.log('✅ No duplicates found! Nothing to clean up.');
      return;
    }

    // Step 2: Show some examples of duplicates
    console.log('\n🔍 Sample duplicates:');
    
    // Find duplicates in our data
    const duplicateMap = new Map();
    userApps.forEach(ua => {
      const key = `${ua.user_id}-${ua.application_id}`;
      if (!duplicateMap.has(key)) {
        duplicateMap.set(key, []);
      }
      duplicateMap.get(key).push(ua);
    });

    const duplicatesArray = Array.from(duplicateMap.entries())
      .filter(([key, records]) => records.length > 1)
      .map(([key, records]) => ({
        email: records[0].user_email,
        app_name: records[0].app_name,
        duplicate_count: records.length
      }))
      .sort((a, b) => b.duplicate_count - a.duplicate_count)
      .slice(0, 5);

    duplicatesArray.forEach(dup => {
      console.log(`  - ${dup.email} → ${dup.app_name} (${dup.duplicate_count} duplicates)`);
    });

    // Step 3: Execute cleanup
    console.log('\n🧹 Executing cleanup...');
    const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
      'remove_duplicate_user_applications', 
      { org_id: MOTIV_HEALTH_ORG_ID }
    );

    if (cleanupError) {
      console.error('❌ Error during cleanup:', cleanupError);
      return;
    }

    console.log(`✅ Cleanup completed! Removed ${cleanupResult} duplicate records.`);

    // Step 4: Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    const { data: afterUserApps, error: afterError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          ua.id,
          ua.user_id,
          ua.application_id
        FROM shadow_it.user_applications ua
        INNER JOIN shadow_it.applications a ON ua.application_id = a.id
        INNER JOIN shadow_it.users u ON ua.user_id = u.id
        WHERE a.organization_id = '${MOTIV_HEALTH_ORG_ID}'
          AND u.organization_id = '${MOTIV_HEALTH_ORG_ID}'
      `
    });

    if (afterError) {
      console.error('❌ Error verifying cleanup:', afterError);
      return;
    }

    const finalTotal = afterUserApps?.length || 0;
    const finalUnique = new Set(afterUserApps?.map(ua => `${ua.user_id}-${ua.application_id}`) || []).size;
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

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
