import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for AI database
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAI = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'AI-database-shadow-it'
  }
});

// QStash signature verification
function verifyQStashSignature(request: NextRequest): boolean {
  const signature = request.headers.get('upstash-signature');
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  
  if (!signature || (!currentSigningKey && !nextSigningKey)) {
    return false;
  }
  
  // In a production environment, you would verify the signature properly
  // For now, we'll just check if the signature exists and keys are configured
  return true;
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Starting slave-to-prod sync process...');
    
    // Verify QStash signature if coming from QStash
    const isFromQStash = request.headers.get('upstash-signature');
    if (isFromQStash && !verifyQStashSignature(request)) {
      console.error('❌ Invalid QStash signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if this is a manual trigger or scheduled
    const isManual = request.headers.get('x-manual-trigger') === 'true';
    console.log(`📊 Sync type: ${isManual ? 'Manual' : 'Scheduled'}`);
    
    // Step 1: Insert new records from slave to main
    console.log('📥 Step 1: Inserting new records from slave database...');
    
    // Since Supabase doesn't support complex INSERT...SELECT with validation easily,
    // let's first get the data we want to insert, then insert it
    const { data: slaveData, error: slaveError } = await supabaseAI
      .schema('ai_risk-analysis_test_dhanu')
      .from('shadow_it_slave')
      .select('*')
      .not('vendor', 'is', null)
      .neq('vendor', '')
      .not('Security Certification', 'is', null)
      .neq('Security Certification', '')
      .not('Supports SSO/SAML/SCIM', 'is', null)
      .neq('Supports SSO/SAML/SCIM', '')
      .not('What the app does', 'is', null)
      .neq('What the app does', '');
    
    if (slaveError) {
      console.error('❌ Error fetching slave data:', slaveError);
      throw new Error(`Fetch slave data failed: ${slaveError.message}`);
    }
    
    console.log(`📊 Found ${slaveData?.length || 0} valid records in slave database`);
    
    // Filter out records that already exist in the main database
    const newRecords = [];
    if (slaveData && slaveData.length > 0) {
      for (const record of slaveData) {
        const { data: existing } = await supabaseAI
          .from('ai_risk_scores')
          .select('Tool Name')
          .eq('Tool Name', record.tool_name)
          .eq('Vendor', record.vendor)
          .single();
        
        if (!existing) {
          // Transform the record to match the target schema
          const transformedRecord = {
            'Tool Name': record.tool_name,
            'Vendor': record.vendor,
            'What the app does': record['What the app does'],
            'URL / Website': record['URL / Website'],
            'Pricing': record.pricing,
            'AI-Native': record['AI-Native'],
            'Key AI Features': record['Key AI Features'],
            'Public AI or Private AI?': record['Public AI or Private AI?'],
            'Open Source?': record['Open Source?'],
            'Type of AI Used': record['Type of AI Used'],
            'Privacy Policy': record['Privacy Policy'],
            'Terms of Use': record['Terms of Use'],
            'Security page': record['Security page'],
            'DPA Link': record['DPA Link'],
            'Status Page': record['Status Page'],
            'Trust Center': record['Trust Center'],
            'Hosted On': record['Hosted On'],
            'Release Date': record['Release Date'],
            'Latest PR': record['Latest PR'],
            'Funding Details': record['Funding Details'],
            'Organization Stage': record['Organization Stage'],
            'Customer Rating': record['Customer Rating'],
            'Community Sentiment': record['Community Sentiment'],
            'Proprietary Model or 3rd Party?': record['Proprietary Model or 3rd Party?'],
            'AI Model Hosting Location / Data Residency': record['AI Model Hosting Location / Data Residency'],
            'Data Sent to AI Model?': record['Data Sent to AI Model?'],
            'Type of Data Sent': record['Type of Data Sent'],
            'Customer/Org Data Used for Model Training?': record['Customer/Org Data Used for Model Training?'],
            'Data Retention Policy': record['Data Retention Policy'],
            'Data Backup/Retrieval/Deletion Details': record['Data Backup/Retrieval/Deletion Details'],
            'User Opt-Out of AI?': record['User Opt-Out of AI?'],
            'Human Review Involvement': record['Human Review Involvement'],
            'Security Certifications': record['Security Certification'],
            'AI Specific Security Standards': record['AI Specific Security Standards'],
            'Vulnerability Disclosure': record['Vulnerability Disclosure'],
            'Recently Known Breaches/ Incidents / Public Issues': record['Recently Known Breaches/ Incidents / Public Issues'],
            'Supports SSO/SAML/SCIM': record['Supports SSO/SAML/SCIM'],
            'Authentication Methods': record['Authentication Methods'],
            'APIs Available?': record['APIs Available?'],
            'Supports RBAC (or some form of user permissions and roles)?': record['Supports RBAC (or some form of user permissions and roles)?'],
            'Bug Bounty System Available?': record['Bug Bounty System Available?'],
            'Trust Contact Info (email ID if available)': record['Trust Contact Info (email ID if available)'],
            'Other AI-Specific Terms / Disclosures': record['Other AI-Specific Terms / Disclosures'],
            'Org Level Criticality (company wide/ specific usage)': record['Org Level Criticality (company wide/ specific usage)'],
            'Departments/Teams Suitable for App Usage': record['Departments/Teams Suitable for App Usage'],
            'Impact to Business (when app data/functionality is compromised)': record['Impact to Business (when app data/functionality is compromised)'],
            'App Performance/Popularity Sentiment': record['App Performance/Popularity Sentiment'],
            'Ease of App Setup': record['Ease of App Setup'],
            'Need Employee Training Before Usage?': record['Need Employee Training Before Usage?'],
            'Overall Security Risk Factor & Tier': record['Overall Security Risk Factor & Tier'],
            'Renewals & Upgrade Terms': record['Renewals & Upgrade Terms'],
            'Notes / Observations': record['Notes / Observations'],
            'Global Adoption Rank': record['Global Adoption Rank'],
            'No. of Active Customers (Reported)': record['No. of Active Customers (Reported)'],
            'Popularity percentage': record['Popularity percentage'],
            'Benchmark Usage by Peers': record['Benchmark Usage by Peers'],
            'Stack Inclusion Rate': record['Stack Inclusion Rate'],
            'Best paired with': record['Best paired with'],
            'Other popular apps in this space': record['Other popular apps in this space'],
            'Data Sensitivity & Processing': record['Data Sensitivity & Processing'],
            'Data Residency & Control': record['Data Residency & Control'],
            'Training Data Usage': record['Training Data Usage'],
            'Policy Transparency': record['Policy Transparency'],
            'Average 1': record['Average 1'],
            'Vulnerability Management': record['Vulnerability Management'],
            'Authentication & Access Controls': record['Authentication & Access Controls'],
            'Breach History': record['Breach History'],
            'Average 2': record['Average 2'],
            'Operational Importance': record['Operational Importance'],
            'Data Criticality': record['Data Criticality'],
            'User Base & Scope': record['User Base & Scope'],
            'Average 3': record['Average 3'],
            'Model Transparency': record['Model Transparency'],
            'Human Oversight': record['Human Oversight'],
            'Model Provenance & Type': record['Model Provenance & Type'],
            'User Opt-Out Options': record['User Opt-Out Options'],
            'Average 4': record['Average 4'],
            'Company Stability': record['Company Stability'],
            'Support & Documentation': record['Support & Documentation'],
            'Integration Complexity': record['Integration Complexity'],
            'Average 5': record['Average 5']
          };
          newRecords.push(transformedRecord);
        }
      }
    }
    
    console.log(`📥 Inserting ${newRecords.length} new records...`);
    
    let insertError = null;
    if (newRecords.length > 0) {
      const { error } = await supabaseAI
        .from('ai_risk_scores')
        .insert(newRecords);
      
      if (error) {
        console.error('❌ Error inserting new records:', error);
        throw new Error(`Insert failed: ${error.message}`);
      }
    }
    
    console.log('✅ New records inserted successfully');
    
    // Check how many records were skipped due to validation
    const { data: allSlaveData } = await supabaseAI
      .schema('ai_risk-analysis_test_dhanu')
      .from('shadow_it_slave')
      .select('*', { count: 'exact', head: true });
    
    const validRecords = slaveData?.length || 0;
    const totalRecords = allSlaveData || 0;
    const skippedCount = totalRecords - validRecords;
    
    if (skippedCount > 0) {
      console.log(`⚠️  ${skippedCount} records skipped due to missing required fields (Vendor, Security Certifications, Supports SSO/SAML/SCIM, What the app does)`);
    }
    
    // Step 2: Update existing records
    console.log('🔄 Step 2: Updating existing records...');
    
    let updateCount = 0;
    if (slaveData && slaveData.length > 0) {
      for (const record of slaveData) {
        // Check if this record exists in the main database
        const { data: existing } = await supabaseAI
          .from('ai_risk_scores')
          .select('Tool Name')
          .eq('Tool Name', record.tool_name)
          .eq('Vendor', record.vendor)
          .single();
        
        if (existing) {
          // Update the existing record
          const updateData = {
            'What the app does': record['What the app does'],
            'URL / Website': record['URL / Website'],
            'Pricing': record.pricing,
            'AI-Native': record['AI-Native'],
            'Key AI Features': record['Key AI Features'],
            'Public AI or Private AI?': record['Public AI or Private AI?'],
            'Open Source?': record['Open Source?'],
            'Type of AI Used': record['Type of AI Used'],
            'Privacy Policy': record['Privacy Policy'],
            'Terms of Use': record['Terms of Use'],
            'Security page': record['Security page'],
            'DPA Link': record['DPA Link'],
            'Status Page': record['Status Page'],
            'Trust Center': record['Trust Center'],
            'Hosted On': record['Hosted On'],
            'Release Date': record['Release Date'],
            'Latest PR': record['Latest PR'],
            'Funding Details': record['Funding Details'],
            'Organization Stage': record['Organization Stage'],
            'Customer Rating': record['Customer Rating'],
            'Community Sentiment': record['Community Sentiment'],
            'Proprietary Model or 3rd Party?': record['Proprietary Model or 3rd Party?'],
            'AI Model Hosting Location / Data Residency': record['AI Model Hosting Location / Data Residency'],
            'Data Sent to AI Model?': record['Data Sent to AI Model?'],
            'Type of Data Sent': record['Type of Data Sent'],
            'Customer/Org Data Used for Model Training?': record['Customer/Org Data Used for Model Training?'],
            'Data Retention Policy': record['Data Retention Policy'],
            'Data Backup/Retrieval/Deletion Details': record['Data Backup/Retrieval/Deletion Details'],
            'User Opt-Out of AI?': record['User Opt-Out of AI?'],
            'Human Review Involvement': record['Human Review Involvement'],
            'Security Certifications': record['Security Certification'],
            'AI Specific Security Standards': record['AI Specific Security Standards'],
            'Vulnerability Disclosure': record['Vulnerability Disclosure'],
            'Recently Known Breaches/ Incidents / Public Issues': record['Recently Known Breaches/ Incidents / Public Issues'],
            'Supports SSO/SAML/SCIM': record['Supports SSO/SAML/SCIM'],
            'Authentication Methods': record['Authentication Methods'],
            'APIs Available?': record['APIs Available?'],
            'Supports RBAC (or some form of user permissions and roles)?': record['Supports RBAC (or some form of user permissions and roles)?'],
            'Bug Bounty System Available?': record['Bug Bounty System Available?'],
            'Trust Contact Info (email ID if available)': record['Trust Contact Info (email ID if available)'],
            'Other AI-Specific Terms / Disclosures': record['Other AI-Specific Terms / Disclosures'],
            'Org Level Criticality (company wide/ specific usage)': record['Org Level Criticality (company wide/ specific usage)'],
            'Departments/Teams Suitable for App Usage': record['Departments/Teams Suitable for App Usage'],
            'Impact to Business (when app data/functionality is compromised)': record['Impact to Business (when app data/functionality is compromised)'],
            'App Performance/Popularity Sentiment': record['App Performance/Popularity Sentiment'],
            'Ease of App Setup': record['Ease of App Setup'],
            'Need Employee Training Before Usage?': record['Need Employee Training Before Usage?'],
            'Overall Security Risk Factor & Tier': record['Overall Security Risk Factor & Tier'],
            'Renewals & Upgrade Terms': record['Renewals & Upgrade Terms'],
            'Notes / Observations': record['Notes / Observations'],
            'Global Adoption Rank': record['Global Adoption Rank'],
            'No. of Active Customers (Reported)': record['No. of Active Customers (Reported)'],
            'Popularity percentage': record['Popularity percentage'],
            'Benchmark Usage by Peers': record['Benchmark Usage by Peers'],
            'Stack Inclusion Rate': record['Stack Inclusion Rate'],
            'Best paired with': record['Best paired with'],
            'Other popular apps in this space': record['Other popular apps in this space'],
            'Data Sensitivity & Processing': record['Data Sensitivity & Processing'],
            'Data Residency & Control': record['Data Residency & Control'],
            'Training Data Usage': record['Training Data Usage'],
            'Policy Transparency': record['Policy Transparency'],
            'Average 1': record['Average 1'],
            'Vulnerability Management': record['Vulnerability Management'],
            'Authentication & Access Controls': record['Authentication & Access Controls'],
            'Breach History': record['Breach History'],
            'Average 2': record['Average 2'],
            'Operational Importance': record['Operational Importance'],
            'Data Criticality': record['Data Criticality'],
            'User Base & Scope': record['User Base & Scope'],
            'Average 3': record['Average 3'],
            'Model Transparency': record['Model Transparency'],
            'Human Oversight': record['Human Oversight'],
            'Model Provenance & Type': record['Model Provenance & Type'],
            'User Opt-Out Options': record['User Opt-Out Options'],
            'Average 4': record['Average 4'],
            'Company Stability': record['Company Stability'],
            'Support & Documentation': record['Support & Documentation'],
            'Integration Complexity': record['Integration Complexity'],
            'Average 5': record['Average 5']
          };
          
          const { error: updateError } = await supabaseAI
            .from('ai_risk_scores')
            .update(updateData)
            .eq('Tool Name', record.tool_name)
            .eq('Vendor', record.vendor);
    
    if (updateError) {
            console.error(`❌ Error updating record ${record.tool_name}:`, updateError);
          } else {
            updateCount++;
          }
        }
      }
    }
    
    console.log(`✅ ${updateCount} existing records updated successfully`);
    
    // Get sync statistics
    const { data: totalCount } = await supabaseAI
      .from('ai_risk_scores')
      .select('*', { count: 'exact', head: true });
    
    const syncResult = {
      success: true,
      message: 'Slave-to-prod sync completed successfully',
      timestamp: new Date().toISOString(),
      type: isManual ? 'manual' : 'scheduled',
      statistics: {
        total_records: totalCount || 0,
        new_records_inserted: newRecords.length,
        existing_records_updated: updateCount,
        records_skipped: skippedCount,
        sync_completed_at: new Date().toISOString()
      }
    };
    
    console.log('🎉 Sync completed:', syncResult);
    
    return NextResponse.json(syncResult);
    
  } catch (error) {
    console.error('❌ Error in slave-to-prod sync:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// GET endpoint for manual testing
export async function GET(request: NextRequest) {
  // Add manual trigger header for GET requests
  const newRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: {
      ...request.headers,
      'x-manual-trigger': 'true'
    }
  });
  
  return POST(newRequest);
} 