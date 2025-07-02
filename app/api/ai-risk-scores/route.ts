import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';
import { calculateFinalAIRiskScore } from '@/app/lib/ai-risk-calculator';

// Create Supabase admin client for main schema
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

interface ApplicationWithAIRisk {
  id: string;
  name: string;
  category: string | null;
  risk_level?: string;
  ai_risk_score?: number | null;
}

// GET - Calculate AI Risk Scores for applications in real-time
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');
    
    if (!orgId) {
      return NextResponse.json({ error: 'Missing org_id parameter' }, { status: 400 });
    }

    // 1. Get organization settings
    const { data: orgSettings, error: settingsError } = await supabaseAdmin
      .from('organization_settings')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('Error fetching org settings:', settingsError);
      return NextResponse.json({ error: 'Failed to fetch organization settings' }, { status: 500 });
    }

    // Use default settings if none exist
    const settings = orgSettings || {
      bucket_weights: {
        dataPrivacy: 20,
        securityAccess: 25,
        businessImpact: 20,
        aiGovernance: 20,
        vendorProfile: 15
      },
      ai_multipliers: {
        native: {
          dataPrivacy: 1.5,
          securityAccess: 1.4,
          businessImpact: 1.3,
          aiGovernance: 1.6,
          vendorProfile: 1.2
        },
        partial: {
          dataPrivacy: 1.2,
          securityAccess: 1.1,
          businessImpact: 1.1,
          aiGovernance: 1.3,
          vendorProfile: 1.0
        },
        none: {
          dataPrivacy: 1.0,
          securityAccess: 1.0,
          businessImpact: 1.0,
          aiGovernance: 1.0,
          vendorProfile: 1.0
        }
      },
      scope_multipliers: {
        high: {
          dataPrivacy: 1.4,
          securityAccess: 1.5,
          businessImpact: 1.3,
          aiGovernance: 1.2,
          vendorProfile: 1.1
        },
        medium: {
          dataPrivacy: 1.2,
          securityAccess: 1.2,
          businessImpact: 1.1,
          aiGovernance: 1.1,
          vendorProfile: 1.0
        },
        low: {
          dataPrivacy: 1.0,
          securityAccess: 1.0,
          businessImpact: 1.0,
          aiGovernance: 1.0,
          vendorProfile: 1.0
        }
      }
    };

    // 2. Get all AI risk scoring data
    const { data: aiRiskData, error: aiError } = await supabaseAIAdmin
      .from('ai_risk_scores')
      .select('*');

    if (aiError) {
      console.error('Error fetching AI risk data:', aiError);
      return NextResponse.json({ error: 'Failed to fetch AI risk data' }, { status: 500 });
    }

    // 3. Get applications for the organization
    const { data: applications, error: appsError } = await supabaseAdmin
      .from('applications')
      .select('id, name, category, risk_level')
      .eq('organization_id', orgId);

    if (appsError) {
      console.error('Error fetching applications:', appsError);
      return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 });
    }

    // 4. Calculate AI Risk Scores for each application in real-time
    const applicationsWithAIRisk: ApplicationWithAIRisk[] = applications.map(app => {
      const aiRiskScore = calculateFinalAIRiskScore(
        {
          id: app.id,
          name: app.name,
          category: app.category,
          riskLevel: app.risk_level,
          lastUsed: '',
          userCount: 0,
          riskScore: 0
        },
        aiRiskData || [],
        {
          bucketWeights: settings.bucket_weights,
          aiMultipliers: settings.ai_multipliers,
          scopeMultipliers: settings.scope_multipliers
        }
      );

      return {
        id: app.id,
        name: app.name,
        category: app.category,
        risk_level: app.risk_level,
        ai_risk_score: aiRiskScore
      };
    });

    // 5. Separate applications with and without AI risk scores
    const appsWithAIRisk = applicationsWithAIRisk.filter(app => app.ai_risk_score !== null);
    const appsWithoutAIRisk = applicationsWithAIRisk.filter(app => app.ai_risk_score === null);

    return NextResponse.json({
      success: true,
      organization_id: orgId,
      total_applications: applications.length,
      applications_with_ai_risk: appsWithAIRisk.length,
      applications_without_ai_risk: appsWithoutAIRisk.length,
      applications: applicationsWithAIRisk,
      settings_used: {
        is_default: !orgSettings,
        bucket_weights: settings.bucket_weights,
        ai_multipliers: settings.ai_multipliers,
        scope_multipliers: settings.scope_multipliers
      }
    });

  } catch (error) {
    console.error('Error calculating AI risk scores:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

 