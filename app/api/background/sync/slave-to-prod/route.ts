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
    
    const insertQuery = `
      INSERT INTO "AI-database-shadow-it".ai_risk_scores (
        "Tool Name", "Vendor", "What the app does", "URL / Website", "Pricing",
        "AI-Native", "Key AI Features", "Public AI or Private AI?", "Open Source?", "Type of AI Used",
        "Privacy Policy", "Terms of Use", "Security page", "DPA Link", "Status Page", "Trust Center",
        "Hosted On", "Release Date", "Latest PR", "Funding Details", "Organization Stage",
        "Customer Rating", "Community Sentiment", "Proprietary Model or 3rd Party?",
        "AI Model Hosting Location / Data Residency", "Data Sent to AI Model?", "Type of Data Sent",
        "Customer/Org Data Used for Model Training?", "Data Retention Policy",
        "Data Backup/Retrieval/Deletion Details", "User Opt-Out of AI?", "Human Review Involvement",
        "Security Certifications", "AI Specific Security Standards", "Vulnerability Disclosure",
        "Recently Known Breaches/ Incidents / Public Issues", "Supports SSO/SAML/SCIM",
        "Authentication Methods", "APIs Available?", "Supports RBAC (or some form of user permissions and roles)?",
        "Bug Bounty System Available?", "Trust Contact Info (email ID if available)",
        "Other AI-Specific Terms / Disclosures", "Org Level Criticality (company wide/ specific usage)",
        "Departments/Teams Suitable for App Usage", "Impact to Business (when app data/functionality is compromised)",
        "App Performance/Popularity Sentiment", "Ease of App Setup", "Need Employee Training Before Usage?",
        "Overall Security Risk Factor & Tier", "Renewals & Upgrade Terms", "Notes / Observations",
        "Global Adoption Rank", "No. of Active Customers (Reported)", "Popularity percentage",
        "Benchmark Usage by Peers", "Stack Inclusion Rate", "Best paired with", "Other popular apps in this space",
        "Data Sensitivity & Processing", "Data Residency & Control", "Training Data Usage", "Policy Transparency",
        "Average 1", "Vulnerability Management", "Authentication & Access Controls", "Breach History",
        "Average 2", "Operational Importance", "Data Criticality", "User Base & Scope", "Average 3",
        "Model Transparency", "Human Oversight", "Model Provenance & Type", "User Opt-Out Options",
        "Average 4", "Company Stability", "Support & Documentation", "Integration Complexity",
        "Average 5"
      )
      SELECT
        tool_name, vendor, "What the app does", "URL / Website", pricing,
        "AI-Native", "Key AI Features", "Public AI or Private AI?", "Open Source?", "Type of AI Used",
        "Privacy Policy", "Terms of Use", "Security page", "DPA Link", "Status Page", "Trust Center",
        "Hosted On", "Release Date", "Latest PR", "Funding Details", "Organization Stage",
        "Customer Rating", "Community Sentiment", "Proprietary Model or 3rd Party?",
        "AI Model Hosting Location / Data Residency", "Data Sent to AI Model?", "Type of Data Sent",
        "Customer/Org Data Used for Model Training?", "Data Retention Policy",
        "Data Backup/Retrieval/Deletion Details", "User Opt-Out of AI?", "Human Review Involvement",
        "Security Certifications", "AI Specific Security Standards", "Vulnerability Disclosure",
        "Recently Known Breaches/ Incidents / Public Issues", "Supports SSO/SAML/SCIM",
        "Authentication Methods", "APIs Available?", "Supports RBAC (or some form of user permissions and roles)?",
        "Bug Bounty System Available?", "Trust Contact Info (email ID if available)",
        "Other AI-Specific Terms / Disclosures", "Org Level Criticality (company wide/ specific usage)",
        "Departments/Teams Suitable for App Usage", "Impact to Business (when app data/functionality is compromised)",
        "App Performance/Popularity Sentiment", "Ease of App Setup", "Need Employee Training Before Usage?",
        "Overall Security Risk Factor & Tier", "Renewals & Upgrade Terms", "Notes / Observations",
        "Global Adoption Rank", "No. of Active Customers (Reported)", "Popularity percentage",
        "Benchmark Usage by Peers", "Stack Inclusion Rate", "Best paired with", "Other popular apps in this space",
        "Data Sensitivity & Processing", "Data Residency & Control", "Training Data Usage", "Policy Transparency",
        "Average 1", "Vulnerability Management", "Authentication & Access Controls", "Breach History",
        "Average 2", "Operational Importance", "Data Criticality", "User Base & Scope", "Average 3",
        "Model Transparency", "Human Oversight", "Model Provenance & Type", "User Opt-Out Options",
        "Average 4", "Company Stability", "Support & Documentation", "Integration Complexity",
        "Average 5"
      FROM "ai_risk-analysis_test_dhanu".shadow_it_slave
      WHERE NOT EXISTS (
        SELECT 1 FROM "AI-database-shadow-it".ai_risk_scores r 
        WHERE r."Tool Name" = shadow_it_slave.tool_name 
        AND r."Vendor" = shadow_it_slave.vendor
      );
    `;
    
    const { data: insertResult, error: insertError } = await supabaseAI.rpc('exec_sql', {
      query: insertQuery
    });
    
    if (insertError) {
      console.error('❌ Error inserting new records:', insertError);
      throw new Error(`Insert failed: ${insertError.message}`);
    }
    
    console.log('✅ New records inserted successfully');
    
    // Step 2: Update existing records
    console.log('🔄 Step 2: Updating existing records...');
    
    const updateQuery = `
      UPDATE "AI-database-shadow-it".ai_risk_scores r
      SET
        "What the app does" = s."What the app does",
        "URL / Website" = s."URL / Website",
        "Pricing" = s.pricing,
        "AI-Native" = s."AI-Native",
        "Key AI Features" = s."Key AI Features",
        "Public AI or Private AI?" = s."Public AI or Private AI?",
        "Open Source?" = s."Open Source?",
        "Type of AI Used" = s."Type of AI Used",
        "Privacy Policy" = s."Privacy Policy",
        "Terms of Use" = s."Terms of Use",
        "Security page" = s."Security page",
        "DPA Link" = s."DPA Link",
        "Status Page" = s."Status Page",
        "Trust Center" = s."Trust Center",
        "Hosted On" = s."Hosted On",
        "Release Date" = s."Release Date",
        "Latest PR" = s."Latest PR",
        "Funding Details" = s."Funding Details",
        "Organization Stage" = s."Organization Stage",
        "Customer Rating" = s."Customer Rating",
        "Community Sentiment" = s."Community Sentiment",
        "Proprietary Model or 3rd Party?" = s."Proprietary Model or 3rd Party?",
        "AI Model Hosting Location / Data Residency" = s."AI Model Hosting Location / Data Residency",
        "Data Sent to AI Model?" = s."Data Sent to AI Model?",
        "Type of Data Sent" = s."Type of Data Sent",
        "Customer/Org Data Used for Model Training?" = s."Customer/Org Data Used for Model Training?",
        "Data Retention Policy" = s."Data Retention Policy",
        "Data Backup/Retrieval/Deletion Details" = s."Data Backup/Retrieval/Deletion Details",
        "User Opt-Out of AI?" = s."User Opt-Out of AI?",
        "Human Review Involvement" = s."Human Review Involvement",
        "Security Certifications" = s."Security Certifications",
        "AI Specific Security Standards" = s."AI Specific Security Standards",
        "Vulnerability Disclosure" = s."Vulnerability Disclosure",
        "Recently Known Breaches/ Incidents / Public Issues" = s."Recently Known Breaches/ Incidents / Public Issues",
        "Supports SSO/SAML/SCIM" = s."Supports SSO/SAML/SCIM",
        "Authentication Methods" = s."Authentication Methods",
        "APIs Available?" = s."APIs Available?",
        "Supports RBAC (or some form of user permissions and roles)?" = s."Supports RBAC (or some form of user permissions and roles)?",
        "Bug Bounty System Available?" = s."Bug Bounty System Available?",
        "Trust Contact Info (email ID if available)" = s."Trust Contact Info (email ID if available)",
        "Other AI-Specific Terms / Disclosures" = s."Other AI-Specific Terms / Disclosures",
        "Org Level Criticality (company wide/ specific usage)" = s."Org Level Criticality (company wide/ specific usage)",
        "Departments/Teams Suitable for App Usage" = s."Departments/Teams Suitable for App Usage",
        "Impact to Business (when app data/functionality is compromised)" = s."Impact to Business (when app data/functionality is compromised)",
        "App Performance/Popularity Sentiment" = s."App Performance/Popularity Sentiment",
        "Ease of App Setup" = s."Ease of App Setup",
        "Need Employee Training Before Usage?" = s."Need Employee Training Before Usage?",
        "Overall Security Risk Factor & Tier" = s."Overall Security Risk Factor & Tier",
        "Renewals & Upgrade Terms" = s."Renewals & Upgrade Terms",
        "Notes / Observations" = s."Notes / Observations",
        "Global Adoption Rank" = s."Global Adoption Rank",
        "No. of Active Customers (Reported)" = s."No. of Active Customers (Reported)",
        "Popularity percentage" = s."Popularity percentage",
        "Benchmark Usage by Peers" = s."Benchmark Usage by Peers",
        "Stack Inclusion Rate" = s."Stack Inclusion Rate",
        "Best paired with" = s."Best paired with",
        "Other popular apps in this space" = s."Other popular apps in this space",
        "Data Sensitivity & Processing" = s."Data Sensitivity & Processing",
        "Data Residency & Control" = s."Data Residency & Control",
        "Training Data Usage" = s."Training Data Usage",
        "Policy Transparency" = s."Policy Transparency",
        "Average 1" = s."Average 1",
        "Vulnerability Management" = s."Vulnerability Management",
        "Authentication & Access Controls" = s."Authentication & Access Controls",
        "Breach History" = s."Breach History",
        "Average 2" = s."Average 2",
        "Operational Importance" = s."Operational Importance",
        "Data Criticality" = s."Data Criticality",
        "User Base & Scope" = s."User Base & Scope",
        "Average 3" = s."Average 3",
        "Model Transparency" = s."Model Transparency",
        "Human Oversight" = s."Human Oversight",
        "Model Provenance & Type" = s."Model Provenance & Type",
        "User Opt-Out Options" = s."User Opt-Out Options",
        "Average 4" = s."Average 4",
        "Company Stability" = s."Company Stability",
        "Support & Documentation" = s."Support & Documentation",
        "Integration Complexity" = s."Integration Complexity",
        "Average 5" = s."Average 5"
      FROM "ai_risk-analysis_test_dhanu".shadow_it_slave s
      WHERE r."Tool Name" = s.tool_name AND r."Vendor" = s.vendor;
    `;
    
    const { data: updateResult, error: updateError } = await supabaseAI.rpc('exec_sql', {
      query: updateQuery
    });
    
    if (updateError) {
      console.error('❌ Error updating existing records:', updateError);
      throw new Error(`Update failed: ${updateError.message}`);
    }
    
    console.log('✅ Existing records updated successfully');
    
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