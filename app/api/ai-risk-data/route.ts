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
    console.log(`[PERF] Fetching AI risk averages for ${shadowAppNames.length} applications...`);

    // OPTIMIZATION: Only fetch the essential fields (averages) for main dashboard
    // Full details will be fetched on-demand via /api/ai-risk-details
    const BATCH_SIZE = 200; // Increased batch size since we're fetching fewer columns
    let allResults: any[] = [];
    
    console.log(`[PERF] Processing ${shadowAppNames.length} apps in batches of ${BATCH_SIZE} (averages only)`);
    
    // Process apps in batches - fetch only essential fields for main dashboard
    for (let i = 0; i < shadowAppNames.length; i += BATCH_SIZE) {
      const batch = shadowAppNames.slice(i, i + BATCH_SIZE);
      console.log(`[PERF] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(shadowAppNames.length/BATCH_SIZE)} (${batch.length} apps)`);
      
      try {
        // Use IN operator with exact matches for better performance with the index
        const { data: batchResults, error: batchError } = await supabaseAIAdmin
          .from('ai_risk_scores')
          .select(`
            "Tool Name",
            "AI-Native",
            "Average 1",
            "Average 2", 
            "Average 3",
            "Average 4",
            "Average 5",
            app_id
          `)
          .in('Tool Name', batch);
          
        if (batchError) {
          console.warn(`[PERF] Error in batch ${Math.floor(i/BATCH_SIZE) + 1}:`, batchError);
          continue; // Skip this batch and continue with next
        }
        
        if (batchResults) {
          allResults.push(...batchResults);
          console.log(`[PERF] Batch ${Math.floor(i/BATCH_SIZE) + 1} found ${batchResults.length} matches`);
        }
      } catch (batchError) {
        console.warn(`[PERF] Exception in batch ${Math.floor(i/BATCH_SIZE) + 1}:`, batchError);
        continue;
      }
    }
    
    console.log(`[PERF] ✅ Completed efficient processing. Found ${allResults.length} AI risk averages (vs ${shadowAppNames.length} requested apps).`);
    
    // Always return results, even if empty - the frontend can handle missing AI data gracefully
    if (allResults.length === 0) {
      console.log('[PERF] ℹ️ No AI risk averages found for any applications in this org');
    }

    // queryError check removed - handled in batch processing above

    // Process results and match with original app names
    const matchedScores: any[] = [];
    const seenAppIds = new Set<number>();
    
    // Create a map for faster lookups
    const resultsMap = new Map<string, any>();
    (allResults || []).forEach(result => {
      const toolName = result['Tool Name']?.toLowerCase().trim();
      if (toolName && !resultsMap.has(toolName)) {
        resultsMap.set(toolName, result);
      }
    });

    // Match each original app name with results more flexibly
    shadowAppNames.forEach(originalAppName => {
      const normalizedName = originalAppName.toLowerCase().trim();
      
      // Prioritize exact match, then flexible 'contains' match
      let match = resultsMap.get(normalizedName);
      
      if (!match) {
        // Fallback to a 'contains' search if exact match fails
        for (const [key, value] of resultsMap.entries()) {
          if (normalizedName.includes(key) || key.includes(normalizedName)) {
            match = value;
            break; // Found a plausible match
          }
        }
      }
      
      if (match && !seenAppIds.has(match.app_id)) {
        matchedScores.push({
          ...match,
          matchedAppName: originalAppName // Use the original app name for consistent matching on client
        });
        seenAppIds.add(match.app_id);
      }
    });

    console.log(`Found ${matchedScores.length} matches out of ${shadowAppNames.length} apps with flexible matching`);

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