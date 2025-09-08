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

// Prefer CLI args, then env, then safe default to N2 org provided by user
function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

const ORG_ID = getArg('org') || process.env.ORGANIZE_ORG_ID 
const DRY_RUN = ['1', 'true', 'yes'].includes((getArg('dry') || process.env.DRY_RUN || '').toString().toLowerCase());
const MATCH_MODE = (getArg('match') || process.env.MATCH_MODE || 'folio').toLowerCase(); // 'exact' | 'normalized' | 'folio'

// Default file path can be overridden via --file or VENDOR_CSV
const DEFAULT_FILE = '/Users/thamim/shadow-it/Vendor_Info_Portfolio - Vendor_Info_Portfolio.csv (1).csv';
const CSV_FILE = getArg('file') || process.env.VENDOR_CSV || DEFAULT_FILE;

// Create Supabase client for organize-app-inbox schema
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'organize-app-inbox' },
  auth: { persistSession: false }
});

// Map vendor CSV billing cycle to valid dropdown values
const VALID_APP_PLANS = ['Annual Plan', 'Monthly Plan', 'Quarterly', 'Usage Based', 'Other'];
function mapBillingCycleToPlan(input) {
  // Blank/none => Other
  if (!input || String(input).trim() === '') return 'Other';
  const value = String(input).toLowerCase().trim();
  // Treat biannual/semi-annual as Other (not Annual Plan)
  if (
    value.includes('biannual') ||
    value.includes('bi-annual') ||
    value.includes('semiannual') ||
    value.includes('semi-annual') ||
    value.includes('semi annual')
  ) {
    return 'Other';
  }
  if (value.includes('annual') || value.includes('yearly') || value === '12-month' || value === '12 month' || value === '12 months') return 'Annual Plan';
  if (value.includes('monthly')) return 'Monthly Plan';
  if (value.includes('quarter')) return 'Quarterly';
  if (value.includes('usage')) return 'Usage Based';
  return 'Other';
}

// Normalize app names (full normalization)
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\bf(olio)?\b$/i, '') // drop trailing "Folio" if present
    .replace(/\s+folio$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Normalize only by removing trailing "Folio" (case-insensitive) and trimming
function normalizeFolioOnly(name) {
  if (!name) return '';
  return String(name)
    .replace(/\s+folio$/i, '')
    .trim();
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

async function importN2VendorCsv() {
  console.log('🚀 Starting N2 vendor CSV import...');
  console.log(`📁 CSV: ${CSV_FILE}`);
  console.log(`🏢 Org (organize-app-inbox): ${ORG_ID}`);
  if (DRY_RUN) {
    console.log('🧪 Dry run enabled: no database writes will be performed');
  }
  console.log(`🔎 Match mode: ${MATCH_MODE}`);

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

    // Fetch existing app names for this org (to avoid duplicates)
    console.log('\n🔍 Fetching existing apps for dedup...');
    const { data: existing, error: fetchError } = await supabase
      .from('apps')
      .select('name')
      .eq('org_id', ORG_ID);
    if (fetchError) throw new Error(`Failed to fetch existing apps: ${fetchError.message}`);

    const existingNames = new Set(
      (existing || []).map((a) => (
        MATCH_MODE === 'exact' ? String(a.name).trim() :
        MATCH_MODE === 'normalized' ? normalizeName(a.name) :
        normalizeFolioOnly(a.name)
      ))
    );
    console.log(`   ✅ Existing apps in org: ${existingNames.size}`);

    // Prepare inserts
    const toInsert = [];
    let skipped = 0;
    let skippedExisting = 0;
    let skippedDuplicateCsv = 0;
    let skippedInvalid = 0;
    const seenCsv = new Set();

    rows.forEach((r) => {
      const rawName = r['NAME']?.trim();
      if (!rawName) { skipped++; skippedInvalid++; return; }

      const matchToken = (
        MATCH_MODE === 'exact' ? String(rawName).trim() :
        MATCH_MODE === 'normalized' ? normalizeName(rawName) :
        normalizeFolioOnly(rawName)
      );
      if (!matchToken) { skipped++; skippedInvalid++; return; }
      if (existingNames.has(matchToken)) { skipped++; skippedExisting++; return; }
      if (seenCsv.has(matchToken)) { skipped++; skippedDuplicateCsv++; return; }

      const owner = (r['Admin'] || '').toString().trim() || null;
      const department = (r['Team(s)'] || '').toString().trim() || null;
      const renewal = (r['Renews on'] || '').toString().trim() || null;
      const plan = mapBillingCycleToPlan(r['Billing cycle']);

      // Choose stored name; remove trailing "Folio" when using folio/normalized
      const displayName = (
        MATCH_MODE === 'exact' ? String(rawName).trim() :
        String(rawName).replace(/\s+folio$/i, '').trim()
      );

      toInsert.push({
        id: crypto.randomUUID(),
        name: displayName,
        owner,
        department,
        renewal_date: renewal || null,
        app_plan: plan,
        org_id: ORG_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        managed_status: 'Managed'
      });
      existingNames.add(matchToken);
      seenCsv.add(matchToken);
    });

    console.log(`\n📝 Prepared for insertion: ${toInsert.length}`);
    console.log(`⏭️  Skipped as existing/invalid: ${skipped}`);
    console.log(`   • Already in DB: ${skippedExisting}`);
    console.log(`   • Duplicate in CSV: ${skippedDuplicateCsv}`);
    console.log(`   • Invalid/missing name: ${skippedInvalid}`);

    console.log(`\n🔢 New apps not in DB for this org (count): ${toInsert.length}`);

    if (DRY_RUN || toInsert.length === 0) {
      console.log('✅ Nothing to insert. Exiting.');
      return;
    }

    // Sample preview
    console.log('\n📋 Sample rows to insert:');
    toInsert.slice(0, 5).forEach((a) => {
      console.log(`   📱 ${a.name} | ${a.app_plan || 'No plan'} | Owner: ${a.owner || 'N/A'}`);
    });

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
        continue;
      }
      insertedCount += inserted?.length || 0;
      console.log(`   ✅ Inserted ${inserted?.length || 0}`);
    }

    console.log('\n🎉 Import complete!');
    console.log('📊 Summary:');
    console.log(`   ➕ Inserted: ${insertedCount}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   🎯 Total apps now (approx): ${existingNames.size}`);
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  }
}

// Add crypto polyfill for Node.js
if (typeof crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto;
}

importN2VendorCsv().catch(console.error);


