import { NextRequest, NextResponse } from 'next/server';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';

export const dynamic = 'force-dynamic';

// GET - Fetches AI risk scoring data for a specific organization
export async function GET(request: NextRequest) {
  try {
    // Get orgId from cookies, which are automatically passed in the request
    const orgId = request.cookies.get('orgId')?.value;

    if (!orgId) {
      // If there's no orgId, there's no data to fetch.
      return NextResponse.json({ success: true, data: [] });
    }

    // First, get the list of app_ids associated with this organization
    const { data: orgApps, error: orgAppsError } = await supabaseAIAdmin
      .from('org_apps')
      .select('app_id')
      .eq('org_id', orgId);

    if (orgAppsError) {
      console.error('Error fetching organization apps link:', orgAppsError);
      return NextResponse.json({ error: 'Failed to fetch organization app links' }, { status: 500 });
    }

    if (!orgApps || orgApps.length === 0) {
      // This organization has no apps in the AI risk database
      return NextResponse.json({ success: true, data: [] });
    }

    const appIds = orgApps.map(app => app.app_id);

    // Now, fetch ALL the detailed data for those specific applications
    const { data: aiRiskData, error: aiError } = await supabaseAIAdmin
      .from('ai_risk_scores')
      .select('*')
      .in('app_id', appIds);

    if (aiError) {
      console.error('Error fetching AI risk data:', aiError);
      return NextResponse.json({ error: 'Failed to fetch AI risk data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: aiRiskData,
    });

  } catch (error) {
    console.error('Error in ai-risk-data route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 