import { NextRequest, NextResponse } from 'next/server';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';

export const dynamic = 'force-dynamic';

// Cache for single app details (shorter TTL since it's less data)
const APP_DETAILS_CACHE = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// GET - Fetches detailed AI risk data for a specific app (for deep dive)
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const appName = searchParams.get('appName');
    const orgId = request.cookies.get('orgId')?.value;

    if (!appName) {
      return NextResponse.json({ error: 'App name is required' }, { status: 400 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const cacheKey = `${orgId}:${appName}`;
    
    // Check cache
    const cached = APP_DETAILS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[PERF] Cache hit for app details: ${appName} (${Date.now() - startTime}ms)`);
      return NextResponse.json({
        success: true,
        data: cached.data,
        fromCache: true,
        responseTime: Date.now() - startTime
      });
    }

    console.log(`[PERF] Fetching detailed AI risk data for single app: "${appName}"`);

    // Fetch detailed data for this specific app using exact match
    const { data: appData, error: queryError } = await supabaseAIAdmin
      .from('ai_risk_scores')
      .select('*')
      .eq('Tool Name', appName)
      .single(); // Use single() since we expect exactly one result

    if (queryError) {
      console.error(`[PERF] Error fetching AI risk details for "${appName}":`, queryError);
      
      // If no exact match, return null (not an error)
      if (queryError.code === 'PGRST116') {
        return NextResponse.json({
          success: true,
          data: null,
          message: `No AI risk data found for app: ${appName}`,
          responseTime: Date.now() - startTime
        });
      }
      
      return NextResponse.json({ error: 'Failed to fetch AI risk details' }, { status: 500 });
    }

    // Cache the result
    APP_DETAILS_CACHE.set(cacheKey, {
      data: appData,
      timestamp: Date.now()
    });

    // Clean old cache entries periodically
    if (APP_DETAILS_CACHE.size > 100) {
      const oldestEntries = Array.from(APP_DETAILS_CACHE.entries())
        .sort(([,a], [,b]) => a.timestamp - b.timestamp)
        .slice(0, 50);
      
      oldestEntries.forEach(([key]) => APP_DETAILS_CACHE.delete(key));
    }

    const responseTime = Date.now() - startTime;
    console.log(`[PERF] ✅ Fetched detailed AI data for "${appName}" in ${responseTime}ms`);

    return NextResponse.json({
      success: true,
      data: appData,
      fromCache: false,
      responseTime
    });

  } catch (error) {
    console.error('[PERF] ❌ Exception in AI risk details endpoint:', error);
    return NextResponse.json({ 
      error: 'Internal server error while fetching AI risk details' 
    }, { status: 500 });
  }
} 