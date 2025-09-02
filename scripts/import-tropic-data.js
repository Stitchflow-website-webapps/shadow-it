#!/usr/bin/env node
// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = 'c138581c-ebe0-4584-a436-bcbce459e419';

// Valid dropdown values from the application
const VALID_APP_PLANS = ['Annual Plan', 'Monthly Plan', 'Quarterly', 'Usage Based', 'Other'];
const VALID_MANAGED_STATUS = ['Managed', 'Unmanaged', 'Newly discovered'];

// Create Supabase client for organize-app-inbox schema
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'organize-app-inbox' },
  auth: { persistSession: false }
});

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

// Function to map billing frequency to valid app_plan values
function mapBillingFrequencyToAppPlan(billingFreq) {
  if (!billingFreq) return null;

  const freq = billingFreq.toLowerCase().trim();

  // Map common billing frequency values to valid dropdown options
  if (freq.includes('annual') || freq.includes('yearly')) {
    return 'Annual Plan';
  } else if (freq.includes('monthly')) {
    return 'Monthly Plan';
  } else if (freq.includes('quarterly') || freq.includes('quarter')) {
    return 'Quarterly';
  } else if (freq.includes('usage') || freq.includes('consumption')) {
    return 'Usage Based';
  } else {
    return 'Other'; // Default for unrecognized values
  }
}

// Function to validate and set managed status
function getValidManagedStatus(status) {
  if (!status) return 'Newly discovered'; // Default value

  const normalizedStatus = status.trim();

  // Check if the status is in the valid list
  if (VALID_MANAGED_STATUS.includes(normalizedStatus)) {
    return normalizedStatus;
  }

  // Default to 'Newly discovered' for invalid values
  return 'Newly discovered';
}

async function importTropicData() {
  console.log('🚀 Starting Tropic data import...');

  try {
    // Parse both CSV files
    console.log('📖 Reading CSV files...');
    const contractData = parseCSV('/Users/aishwaryaashok/shadow-it-augment/shadow-it/Tropic_Contract.csv');
    const supplierData = parseCSV('/Users/aishwaryaashok/shadow-it-augment/shadow-it/Tropic_Suppliers.csv');

    console.log(`📊 Found ${contractData.length} contracts and ${supplierData.length} suppliers`);

    // Calculate overlap between the two CSV files
    console.log('\n🔍 Analyzing overlap between CSV files...');
    const contractAppNames = new Set(
      contractData
        .map(row => row.Supplier?.trim())
        .filter(name => name) // Remove empty names
        .map(name => name.toLowerCase())
    );

    const supplierAppNames = new Set(
      supplierData
        .map(row => row.Supplier?.trim())
        .filter(name => name) // Remove empty names
        .map(name => name.toLowerCase())
    );

    // Find overlapping apps
    const overlappingApps = new Set(
      [...contractAppNames].filter(name => supplierAppNames.has(name))
    );

    // Calculate unique apps in each file
    const contractOnlyApps = new Set(
      [...contractAppNames].filter(name => !supplierAppNames.has(name))
    );

    const supplierOnlyApps = new Set(
      [...supplierAppNames].filter(name => !contractAppNames.has(name))
    );

    console.log(`📈 CSV Overlap Analysis:`);
    console.log(`   📋 Apps in Contract CSV: ${contractAppNames.size}`);
    console.log(`   📋 Apps in Supplier CSV: ${supplierAppNames.size}`);
    console.log(`   🔄 Overlapping apps: ${overlappingApps.size}`);
    console.log(`   📝 Contract-only apps: ${contractOnlyApps.size}`);
    console.log(`   📝 Supplier-only apps: ${supplierOnlyApps.size}`);
    console.log(`   📊 Total unique apps across both files: ${contractAppNames.size + supplierOnlyApps.size}`);

    // Show some examples of overlapping apps
    if (overlappingApps.size > 0) {
      console.log(`\n🔄 Sample overlapping apps (Contract data will be prioritized):`);
      Array.from(overlappingApps).slice(0, 5).forEach(appName => {
        console.log(`   📱 ${appName}`);
      });
      if (overlappingApps.size > 5) {
        console.log(`   ... and ${overlappingApps.size - 5} more`);
      }
    }

    // Get existing apps to avoid duplicates (only for this org ID)
    console.log('\n🔍 Checking existing apps in database...');
    const { data: existingApps, error: fetchError } = await supabase
      .from('apps')
      .select('name')
      .eq('org_id', ORG_ID);

    if (fetchError) {
      throw new Error(`Failed to fetch existing apps: ${fetchError.message}`);
    }

    const existingAppNames = new Set(existingApps.map(app => app.name.toLowerCase()));
    console.log(`📋 Found ${existingAppNames.size} existing apps in this organization`);
    
    // Step 1: Process contract data first (priority data)
    const contractApps = new Map();
    let contractProcessed = 0;
    let contractSkipped = 0;

    console.log('\n📋 Processing Contract CSV (Priority)...');
    contractData.forEach(row => {
      const supplierName = row.Supplier?.trim();
      if (!supplierName || existingAppNames.has(supplierName.toLowerCase())) {
        contractSkipped++;
        return; // Skip if empty or already exists in database
      }

      // Handle nullable fields properly with validation
      const endDate = row['End Date']?.trim();
      const billingFreq = row['Billing Frequency']?.trim();
      const mappedAppPlan = mapBillingFrequencyToAppPlan(billingFreq);

      contractApps.set(supplierName.toLowerCase(), {
        id: crypto.randomUUID(),
        name: supplierName,
        renewal_date: endDate || null,
        app_plan: mappedAppPlan,
        org_id: ORG_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        managed_status: getValidManagedStatus('Managed'), // Set as 'Managed' for contract apps
        //stitchflow_status: 'Yes - CSV Sync',//
        _source: 'contract' // Track source for counting
      });
      contractProcessed++;
    });

    console.log(`   ✅ Contract apps processed: ${contractProcessed}`);
    console.log(`   ⏭️  Contract apps skipped (existing): ${contractSkipped}`);

    // Step 2: Process supplier data (only add if NOT in contract data)
    let supplierProcessed = 0;
    let supplierSkipped = 0;

    console.log('\n📋 Processing Supplier CSV (Secondary)...');
    supplierData.forEach(row => {
      const supplierName = row.Supplier?.trim();
      if (!supplierName ||
          existingAppNames.has(supplierName.toLowerCase()) ||
          contractApps.has(supplierName.toLowerCase())) {
        supplierSkipped++;
        return; // Skip if empty, already exists in DB, or already in contract data
      }

      contractApps.set(supplierName.toLowerCase(), {
        id: crypto.randomUUID(),
        name: supplierName,
        renewal_date: null, // No renewal data in supplier CSV
        app_plan: null,     // No plan data in supplier CSV
        org_id: ORG_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        managed_status: getValidManagedStatus('Managed'), // ✅ Supplier apps are also managed
        stitchflow_status: 'Yes - CSV Sync',
        _source: 'supplier' // Track source for counting
      });
      supplierProcessed++;
    });

    console.log(`   ✅ Supplier apps processed: ${supplierProcessed}`);
    console.log(`   ⏭️  Supplier apps skipped (existing/duplicate): ${supplierSkipped}`);

    const finalAppsToInsert = Array.from(contractApps.values());
    console.log(`\n📝 Total apps prepared for insertion: ${finalAppsToInsert.length}`);

    if (finalAppsToInsert.length === 0) {
      console.log('✅ No new apps to insert');
      return;
    }

    // Show sample of what will be inserted with validation info
    console.log('\n📋 Sample apps to be inserted:');
    finalAppsToInsert.slice(0, 5).forEach(app => {
      console.log(`   📱 ${app.name}`);
      console.log(`      📅 Renewal: ${app.renewal_date || 'Not specified'}`);
      console.log(`      💳 Plan: ${app.app_plan || 'Not specified'} ${app.app_plan ? '✅' : ''}`);
      console.log(`      🏷️  Status: ${app.managed_status} ✅`);
    });
    
    // Insert in batches
    const BATCH_SIZE = 50;
    let insertedCount = 0;
    let contractSourceCount = 0;
    let supplierSourceCount = 0;
    let validAppPlanCount = 0;

    // Pre-calculate counts from the source data
    finalAppsToInsert.forEach(app => {
      if (app._source === 'contract') {
        contractSourceCount++;
      } else {
        supplierSourceCount++;
      }
      if (app.app_plan && VALID_APP_PLANS.includes(app.app_plan)) {
        validAppPlanCount++;
      }
    });

    // Remove the _source field before inserting (don't store it in database)
    const cleanedAppsToInsert = finalAppsToInsert.map(app => {
      const { _source, ...cleanApp } = app;
      return cleanApp;
    });

    for (let i = 0; i < cleanedAppsToInsert.length; i += BATCH_SIZE) {
      const batch = cleanedAppsToInsert.slice(i, i + BATCH_SIZE);
      console.log(`📤 Inserting batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(cleanedAppsToInsert.length/BATCH_SIZE)} (${batch.length} apps)...`);

      const { data: insertedApps, error: insertError } = await supabase
        .from('apps')
        .insert(batch)
        .select('name');

      if (insertError) {
        console.error(`❌ Error inserting batch: ${insertError.message}`);
        continue;
      }

      insertedCount += insertedApps?.length || 0;
      console.log(`✅ Successfully inserted ${insertedApps?.length || 0} apps in this batch`);
    }
    
    console.log(`\n🎉 Import completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   📁 Contract CSV: ${contractData.length} rows`);
    console.log(`   📁 Supplier CSV: ${supplierData.length} rows`);
    console.log(`   🔄 Overlapping apps between CSVs: ${overlappingApps.size}`);
    console.log(`   ⚡ Existing apps (skipped): ${existingAppNames.size}`);
    console.log(`   ➕ New apps inserted: ${insertedCount}`);
    console.log(`   📋 Apps from contract source: ${contractSourceCount}`);
    console.log(`   📋 Apps from supplier source only: ${supplierSourceCount}`);
    console.log(`   🎯 Total apps in database: ${existingAppNames.size + insertedCount}`);

    console.log(`\n📈 Data Validation Summary:`);
    console.log(`   ✅ Valid app plans mapped: ${validAppPlanCount}`);
    console.log(`   ✅ All managed statuses validated: ${insertedCount}`);
    console.log(`   📅 Apps from contract source: ${contractSourceCount}`);
    console.log(`   💳 Apps with billing plans: ${validAppPlanCount}`);
    
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  }
}

// Add crypto polyfill for Node.js
if (typeof crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto;
}

// Validate environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

importTropicData().catch(console.error);