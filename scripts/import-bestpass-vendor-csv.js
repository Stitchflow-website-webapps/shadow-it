#!/usr/bin/env node
// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// BestPass organization IDs
const BESTPASS_ORG_ID = ''; // organize-app-inbox
const BESTPASS_SHADOW_ORG_ID = ''; // shadow_it

// CLI arguments
function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const DRY_RUN = ['1', 'true', 'yes'].includes((getArg('dry') || process.env.DRY_RUN || '').toString().toLowerCase());
const CSV_FILE = getArg('file') || '/Users/thamim/shadow-it/All_suppliers_vendor_beatpass.csv';

// Create Supabase client for organize-app-inbox schema
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'organize-app-inbox' },
  auth: { persistSession: false }
});

// Keep the original vendor status as is
function keepOriginalStatus(status) {
  return String(status || '').trim() || null;
}

// Simply return the annualized spend as plan reference
function getSpendAsPlanReference(spend) {
  return String(spend || '').trim() || null;
}

function parseCsvFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const { data, errors } = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });
  if (errors && errors.length > 0) {
    console.warn('⚠️  CSV parse warnings:', errors.slice(0, 3));
  }
  return data;
}

async function importBestpassVendorCsv() {
  console.log('🚀 Starting BestPass vendor CSV import...');
  console.log(`📁 CSV: ${CSV_FILE}`);
  console.log(`🏢 BestPass Org (organize-app-inbox): ${BESTPASS_ORG_ID}`);
  console.log(`🏢 BestPass Shadow IT Org: ${BESTPASS_SHADOW_ORG_ID}`);
  if (DRY_RUN) {
    console.log('🧪 Dry run enabled: no database writes will be performed');
  }

  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   NEXT_PUBLIC_SUPABASE_URL');
    console.error('   SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Validate file
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`❌ CSV file not found: ${CSV_FILE}`);
    process.exit(1);
  }

  try {
    // Parse CSV
    console.log('📖 Reading CSV...');
    const rows = parseCsvFile(CSV_FILE);
    console.log(`📊 Rows in CSV (excluding header): ${rows.length}`);

    // Show sample of what we're parsing
    console.log('\n📋 Sample CSV data:');
    rows.slice(0, 3).forEach((row, idx) => {
      console.log(`   ${idx + 1}. ${row['Legal Name']} | ${row['Status']} | Owner: ${row['Owner'] || 'N/A'} | Spend: ${row['Annualized spend'] || '$0'}`);
    });

    // Fetch existing app names for this org (to avoid duplicates)
    console.log('\n🔍 Fetching existing apps for dedup...');
    const { data: existing, error: fetchError } = await supabase
      .from('apps')
      .select('name')
      .eq('org_id', BESTPASS_ORG_ID);
    if (fetchError) throw new Error(`Failed to fetch existing apps: ${fetchError.message}`);

    const existingNames = new Set(
      (existing || []).map((a) => String(a.name).trim().toLowerCase())
    );
    console.log(`   ✅ Existing apps in org: ${existingNames.size}`);

    // Prepare inserts
    const toInsert = [];
    let skipped = 0;
    let skippedExisting = 0;
    let skippedDuplicateCsv = 0;
    let skippedInvalid = 0;
    const seenCsv = new Set();

    rows.forEach((row, index) => {
      const legalName = String(row['Legal Name'] || '').trim();
      if (!legalName) { 
        console.log(`   ⚠️  Row ${index + 1}: Missing legal name`);
        skipped++; 
        skippedInvalid++; 
        return; 
      }

      const normalizedName = legalName.toLowerCase();
      
      // Check for existing app
      if (existingNames.has(normalizedName)) { 
        console.log(`   ⏭️  Row ${index + 1}: "${legalName}" already exists in DB`);
        skipped++; 
        skippedExisting++; 
        return; 
      }
      
      // Check for duplicate in CSV
      if (seenCsv.has(normalizedName)) { 
        console.log(`   ⏭️  Row ${index + 1}: "${legalName}" duplicate in CSV`);
        skipped++; 
        skippedDuplicateCsv++; 
        return; 
      }

      const technicalOwner = String(row['Owner'] || '').trim() || null;
      const annualizedSpend = String(row['Annualized spend'] || '').trim();
      
      const planReference = getSpendAsPlanReference(annualizedSpend);

      toInsert.push({
        id: crypto.randomUUID(),
        name: legalName,
        technical_owner: technicalOwner,
        plan_reference: planReference, // Direct annualized spend amount
        org_id: BESTPASS_ORG_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      
      seenCsv.add(normalizedName);
    });

    console.log(`\n📝 Prepared for insertion: ${toInsert.length}`);
    console.log(`⏭️  Skipped total: ${skipped}`);
    console.log(`   • Already in DB: ${skippedExisting}`);
    console.log(`   • Duplicate in CSV: ${skippedDuplicateCsv}`);
    console.log(`   • Invalid/missing name: ${skippedInvalid}`);

    if (toInsert.length === 0) {
      console.log('✅ Nothing to insert. Exiting.');
      return;
    }


    // Sample preview
    console.log('\n📋 Sample rows to insert:');
    toInsert.slice(0, 5).forEach((app) => {
      console.log(`   📱 ${app.name} | Spend: ${app.plan_reference || 'N/A'} | Owner: ${app.technical_owner || 'N/A'}`);
    });

    if (DRY_RUN) {
      console.log('\n🧪 Dry run complete - no actual inserts performed');
      return;
    }

    // Batch insert
    const BATCH_SIZE = 50;
    let insertedCount = 0;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      console.log(`📤 Inserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toInsert.length / BATCH_SIZE)} (${batch.length})...`);
      
      const { data: inserted, error: insertError } = await supabase
        .from('apps')
        .insert(batch)
        .select('name');
      
      if (insertError) {
        console.error(`❌ Error inserting batch: ${insertError.message}`);
        console.error('   First few items in failed batch:');
        batch.slice(0, 3).forEach(app => {
          console.error(`   - ${app.name}`);
        });
        continue;
      }
      
      insertedCount += inserted?.length || 0;
      console.log(`   ✅ Inserted ${inserted?.length || 0} apps`);
    }

    console.log('\n🎉 Import complete!');
    console.log('📊 Final Summary:');
    console.log(`   ➕ Successfully inserted: ${insertedCount}`);
    console.log(`   ⏭️  Skipped total: ${skipped}`);
    console.log(`   📱 Total processed: ${rows.length}`);
    console.log(`   🏢 Organization: BestPass (${BESTPASS_ORG_ID})`);

  } catch (err) {
    console.error('❌ Import failed:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}

// Add crypto polyfill for Node.js
if (typeof crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto;
}

importBestpassVendorCsv().catch(console.error);
