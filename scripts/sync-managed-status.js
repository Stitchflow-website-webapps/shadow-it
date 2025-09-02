#!/usr/bin/env node
// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORGANIZE_ORG_ID = 'c138581c-ebe0-4584-a436-bcbce459e419'; // organize-app-inbox org ID
const SHADOW_IT_ORG_ID = '06082830-06bf-4fb2-bfdd-d955ff996abc'; // shadow_it org ID

// Create Supabase clients for different schemas
const organizeClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'organize-app-inbox' },
  auth: { persistSession: false }
});

const shadowItClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'shadow_it' },
  auth: { persistSession: false }
});

async function syncManagedStatus() {
  console.log('🚀 Starting management status sync...');
  console.log(`📋 Organize-app-inbox org ID: ${ORGANIZE_ORG_ID}`);
  console.log(`📋 Shadow-it org ID: ${SHADOW_IT_ORG_ID}`);

  try {
    // Step 1: Get all apps from organize-app-inbox for this organization
    console.log('\n📖 Fetching apps from organize-app-inbox schema...');
    const { data: organizeApps, error: organizeError } = await organizeClient
      .from('apps')
      .select('id, name')
      .eq('org_id', ORGANIZE_ORG_ID);
    
    if (organizeError) {
      throw new Error(`Failed to fetch organize apps: ${organizeError.message}`);
    }
    
    console.log(`   ✅ Found ${organizeApps.length} apps in organize-app-inbox`);
    
    if (organizeApps.length === 0) {
      console.log('⚠️  No apps found in organize-app-inbox for this organization');
      return;
    }
    
    // Step 2: Get all apps from shadow_it schema for this organization
    console.log('\n📖 Fetching apps from shadow_it schema...');
    const { data: shadowApps, error: shadowError } = await shadowItClient
      .from('applications')
      .select('id, name, management_status')
      .eq('organization_id', SHADOW_IT_ORG_ID);
    
    if (shadowError) {
      throw new Error(`Failed to fetch shadow_it apps: ${shadowError.message}`);
    }
    
    console.log(`   ✅ Found ${shadowApps.length} apps in shadow_it`);
    
    if (shadowApps.length === 0) {
      console.log('⚠️  No apps found in shadow_it for this organization');
      return;
    }
    
    // Step 3: Create lookup maps for efficient matching (case-insensitive only, no trimming)
    const organizeAppNames = new Set(
      organizeApps.map(app => app.name.toLowerCase())
    );

    const shadowAppsByName = new Map();
    shadowApps.forEach(app => {
      const normalizedName = app.name.toLowerCase();
      shadowAppsByName.set(normalizedName, app);
    });
    
    // Step 4: Find matching apps
    console.log('\n🔍 Finding matching apps...');
    const matchingApps = [];
    const appsToUpdate = [];
    
    organizeApps.forEach(organizeApp => {
      const normalizedName = organizeApp.name.toLowerCase();
      const shadowApp = shadowAppsByName.get(normalizedName);
      
      if (shadowApp) {
        matchingApps.push({
          organizeName: organizeApp.name,
          shadowName: shadowApp.name,
          shadowId: shadowApp.id,
          currentStatus: shadowApp.management_status
        });
        
        // Only update if current status is not already "Managed"
        if (shadowApp.management_status !== 'Managed') {
          appsToUpdate.push({
            id: shadowApp.id,
            name: shadowApp.name,
            currentStatus: shadowApp.management_status
          });
        }
      }
    });
    
    console.log(`   🔄 Total matching apps found: ${matchingApps.length}`);
    console.log(`   📝 Apps needing status update: ${appsToUpdate.length}`);
    
    // Step 5: Show matching summary
    if (matchingApps.length > 0) {
      console.log('\n📋 Sample matching apps:');
      matchingApps.slice(0, 5).forEach(match => {
        const statusIcon = match.currentStatus === 'Managed' ? '✅' : '🔄';
        console.log(`   ${statusIcon} ${match.organizeName} → ${match.currentStatus}`);
      });
      
      if (matchingApps.length > 5) {
        console.log(`   ... and ${matchingApps.length - 5} more matches`);
      }
    }
    
    // Step 6: Update management status to "Managed"
    if (appsToUpdate.length === 0) {
      console.log('\n✅ All matching apps already have "Managed" status');
      return;
    }
    
    console.log(`\n📤 Updating ${appsToUpdate.length} apps to "Managed" status...`);
    
    // Update in batches
    const BATCH_SIZE = 50;
    let updatedCount = 0;
    
    for (let i = 0; i < appsToUpdate.length; i += BATCH_SIZE) {
      const batch = appsToUpdate.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map(app => app.id);
      
      console.log(`   📤 Updating batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(appsToUpdate.length/BATCH_SIZE)} (${batch.length} apps)...`);
      
      const { data: updatedApps, error: updateError } = await shadowItClient
        .from('applications')
        .update({ management_status: 'Managed' })
        .in('id', batchIds)
        .select('id, name, management_status');
      
      if (updateError) {
        console.error(`   ❌ Error updating batch: ${updateError.message}`);
        continue;
      }
      
      updatedCount += updatedApps?.length || 0;
      console.log(`   ✅ Successfully updated ${updatedApps?.length || 0} apps in this batch`);
    }
    
    // Step 7: Final summary
    console.log(`\n🎉 Sync completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   📋 Apps in organize-app-inbox: ${organizeApps.length}`);
    console.log(`   📋 Apps in shadow_it: ${shadowApps.length}`);
    console.log(`   🔄 Matching apps found: ${matchingApps.length}`);
    console.log(`   📝 Apps updated to "Managed": ${updatedCount}`);
    console.log(`   ✅ Apps already "Managed": ${matchingApps.length - appsToUpdate.length}`);
    
    // Show apps that didn't match
    const unmatchedOrganizeApps = organizeApps.filter(organizeApp => {
      const normalizedName = organizeApp.name.toLowerCase();
      return !shadowAppsByName.has(normalizedName);
    });
    
    if (unmatchedOrganizeApps.length > 0) {
      console.log(`\n⚠️  Apps in organize-app-inbox but not in shadow_it: ${unmatchedOrganizeApps.length}`);
      console.log(`   📝 Sample unmatched apps:`);
      unmatchedOrganizeApps.slice(0, 5).forEach(app => {
        console.log(`      📱 ${app.name}`);
      });
      if (unmatchedOrganizeApps.length > 5) {
        console.log(`      ... and ${unmatchedOrganizeApps.length - 5} more`);
      }
    }
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Validate environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

syncManagedStatus().catch(console.error);
