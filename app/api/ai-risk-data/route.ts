import { NextRequest, NextResponse } from 'next/server';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET - Fetches AI risk scoring data for a specific organization by matching app names
export async function GET(request: NextRequest) {
  try {
    const orgId = request.cookies.get('orgId')?.value;

    if (!orgId) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Use the admin client configured for the 'shadow_it' schema
    const { data: applications, error: appsError } = await supabaseAdmin
      .from('applications')
      .select('name')
      .eq('organization_id', orgId);

    if (appsError) {
      console.error('Error fetching applications for org:', appsError);
      return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 });
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const shadowAppNames = applications.map((app: { name: string }) => app.name);

    // Simplified: Only exact matches for better performance
    // Use case-insensitive exact matches with the Tool Name column
    const exactMatchPromises = shadowAppNames.map(appName => {
      const normalizedAppName = appName.toLowerCase().trim();
      return supabaseAIAdmin
        .from('ai_risk_scores')
        .select('*')
        .ilike('Tool Name', normalizedAppName); // Case-insensitive exact match
    });

    const results = await Promise.all(exactMatchPromises);
    
    const matchedScores: any[] = [];
    const seenAppIds = new Set<number>();

    results.forEach((result, index) => {
      if (result.error) {
        console.error(`Error fetching AI risk data for ${shadowAppNames[index]}:`, result.error);
        return; // Skip this app, continue with others
      }
      
      if (result.data && result.data.length > 0) {
        // Take the first match (should be exact)
        const match = result.data[0];
        if (!seenAppIds.has(match.app_id)) {
          matchedScores.push({
            ...match,
            matchedAppName: shadowAppNames[index].toLowerCase().trim()
          });
          seenAppIds.add(match.app_id);
        }
      }
    });

    console.log(`Found ${matchedScores.length} exact matches out of ${shadowAppNames.length} apps`);

    return NextResponse.json({
      success: true,
      data: matchedScores,
    });

  } catch (error) {
    console.error('Error in ai-risk-data route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 