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

    // Performance Optimization: Instead of fetching all risk scores, we build a
    // dynamic query to fetch only likely candidates. We break down app names into
    // unique words (e.g., "Zoom for Gov" -> "zoom", "gov") and search for tools
    // containing any of those words.
    const uniqueWords = new Set<string>();
    shadowAppNames.forEach((name: string) => {
      name.toLowerCase().trim().split(/[^a-z0-9]+/).forEach(word => {
        if (word.length > 2) { // Ignore short/common words
          uniqueWords.add(word);
        }
      });
    });

    if (uniqueWords.size === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Batching to avoid URL length limits with a large number of OR clauses.
    const wordChunks: string[][] = [];
    const words = Array.from(uniqueWords);
    const chunkSize = 50; // Supabase/PostgREST can handle about this many OR clauses.

    for (let i = 0; i < words.length; i += chunkSize) {
      wordChunks.push(words.slice(i, i + chunkSize));
    }

    const promises = wordChunks.map(chunk => {
      const orFilter = chunk.map(word => `"Tool Name".ilike.%${word}%`).join(',');
      return supabaseAIAdmin.from('ai_risk_scores').select('*').or(orFilter);
    });

    const results = await Promise.all(promises);
    
    const candidateAiRiskScores: any[] = [];
    const seenIds = new Set<number>();

    for (const result of results) {
      if (result.error) {
        console.error('Error fetching a chunk of AI risk data:', result.error);
        // If one chunk fails, we fail the whole request to avoid partial data.
        return NextResponse.json({ error: 'Failed to fetch AI risk data chunk' }, { status: 500 });
      }
      if (result.data) {
        result.data.forEach(score => {
          if (!seenIds.has(score.app_id)) {
            candidateAiRiskScores.push(score);
            seenIds.add(score.app_id);
          }
        });
      }
    }

    if (candidateAiRiskScores.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Now, run the more precise matching logic on the smaller, pre-filtered dataset.
    const matchedScores = new Map<string, any>();
    const matchedRiskAppIds = new Set<number>();

    const escapeRegExp = (str: string) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Prioritize exact matches
    shadowAppNames.forEach((shadowName: string) => {
      const lowerShadowName = shadowName.toLowerCase().trim();
      candidateAiRiskScores.forEach(riskScore => {
        const toolName = riskScore['Tool Name']?.toLowerCase().trim();
        if (lowerShadowName === toolName) {
          if (!matchedScores.has(lowerShadowName)) {
            matchedScores.set(lowerShadowName, riskScore);
            matchedRiskAppIds.add(riskScore.app_id);
          }
        }
      });
    });

    // Fuzzy match for remaining apps
    shadowAppNames.forEach((shadowName: string) => {
      const lowerShadowName = shadowName.toLowerCase().trim();
      if (matchedScores.has(lowerShadowName)) {
        return; // Already has an exact match
      }

      let bestMatch: any = null;
      let highestScore = 0;

      candidateAiRiskScores.forEach(riskScore => {
        if (matchedRiskAppIds.has(riskScore.app_id)) {
          return; // This risk score is already taken by an exact match
        }

        const toolName = riskScore['Tool Name']?.toLowerCase().trim();
        if (!toolName) return;

        let score = 0;
        const shadowWords = lowerShadowName.split(/[^a-z0-9]+/).filter((w: string) => w.length > 1);
        const toolWords = toolName.split(/[^a-z0-9]+/).filter((w: string) => w.length > 1);
        const intersection = shadowWords.filter((w: string) => toolWords.includes(w));
        score = intersection.length;

        if (score > highestScore) {
          highestScore = score;
          bestMatch = riskScore;
        } else if (score === highestScore && bestMatch) {
          // Tie-break with length, closer length is better
          if (Math.abs(toolName.length - lowerShadowName.length) < Math.abs(bestMatch['Tool Name'].toLowerCase().trim().length - lowerShadowName.length)) {
            bestMatch = riskScore;
          }
        }
      });

      if (bestMatch && highestScore > 0) {
        matchedScores.set(lowerShadowName, bestMatch);
        matchedRiskAppIds.add(bestMatch.app_id);
      }
    });

    const uniqueMatchedScores = Array.from(matchedScores.values());

    return NextResponse.json({
      success: true,
      data: uniqueMatchedScores,
    });

  } catch (error) {
    console.error('Error in ai-risk-data route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 