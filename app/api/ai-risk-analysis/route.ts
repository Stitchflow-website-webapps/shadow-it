import { NextRequest, NextResponse } from 'next/server';
import { supabaseAIAdmin } from '@/lib/supabase-ai-schema';
import { supabaseAdmin } from '@/lib/supabase';
import { transformRiskLevel } from '@/lib/risk-assessment';

// Simple in-memory cache with TTL
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clear cache function for debugging
function clearCache() {
  cache.clear();
  console.log('[PERF] Cache cleared');
}

function getCachedData(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCachedData(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Helper function to determine category based on AI-Native field
function determineCategory(aiNative: string): string {
  if (!aiNative) return 'No GenAI';
  
  const normalized = aiNative.toLowerCase().trim();
  if (normalized.includes('native') || normalized.includes('yes')) return 'GenAI native';
  if (normalized.includes('partial')) return 'GenAI partial';
  return 'No GenAI';
}

// Helper function to determine scope risk based on score
function determineScopeRisk(score: number): string {
  if (score >= 4.0) return 'High';
  if (score >= 2.5) return 'Medium';
  return 'Low';
}

// Default organization settings
function getDefaultOrgSettings() {
  return {
    bucketWeights: {
      dataPrivacy: 20,
      securityAccess: 25,
      businessImpact: 20,
      aiGovernance: 15,
      vendorProfile: 20
    },
    aiMultipliers: {
      native: { dataPrivacy: 1.5, securityAccess: 1.8, businessImpact: 1.3, aiGovernance: 2.0, vendorProfile: 1.2 },
      partial: { dataPrivacy: 1.2, securityAccess: 1.4, businessImpact: 1.1, aiGovernance: 1.5, vendorProfile: 1.1 },
      none: { dataPrivacy: 1.0, securityAccess: 1.0, businessImpact: 1.0, aiGovernance: 1.0, vendorProfile: 1.0 }
    },
    scopeMultipliers: {
      high: { dataPrivacy: 1.8, securityAccess: 2.0, businessImpact: 1.4, aiGovernance: 1.6, vendorProfile: 1.3 },
      medium: { dataPrivacy: 1.3, securityAccess: 1.5, businessImpact: 1.2, aiGovernance: 1.2, vendorProfile: 1.1 },
      low: { dataPrivacy: 1.0, securityAccess: 1.0, businessImpact: 1.0, aiGovernance: 1.0, vendorProfile: 1.0 }
    }
  };
}

// Server-side risk calculation function - EXACT match with deep dive logic
function calculateFinalRiskScore(aiData: any, appData: any, orgSettings: any): number {
  if (!aiData) return 0;
  
  // Define scoring criteria using organization settings
  const scoringCriteria = {
    dataPrivacy: { weight: orgSettings.bucketWeights.dataPrivacy, averageField: "Average 1" },
    securityAccess: { weight: orgSettings.bucketWeights.securityAccess, averageField: "Average 2" },
    businessImpact: { weight: orgSettings.bucketWeights.businessImpact, averageField: "Average 3" },
    aiGovernance: { weight: orgSettings.bucketWeights.aiGovernance, averageField: "Average 4" },
    vendorProfile: { weight: orgSettings.bucketWeights.vendorProfile, averageField: "Average 5" }
  };

  // Get AI status
  const aiStatus = aiData?.["AI-Native"]?.toLowerCase() || "";
  
  // Get scope risk from the actual app data
  const getCurrentScopeRisk = () => {
    if (appData && appData.riskLevel) {
      const riskLevel = transformRiskLevel(appData.riskLevel);
      return riskLevel.toUpperCase();
    }
    return 'MEDIUM';
  };
  
  const currentScopeRisk = getCurrentScopeRisk();
  
  // Get scope multipliers from organization settings
  const getScopeMultipliers = (scopeRisk: string) => {
    if (scopeRisk === 'HIGH') return orgSettings.scopeMultipliers.high;
    if (scopeRisk === 'MEDIUM') return orgSettings.scopeMultipliers.medium;
    return orgSettings.scopeMultipliers.low;
  };

  const scopeMultipliers = getScopeMultipliers(currentScopeRisk);
  
  // Get AI multipliers from organization settings - FIXED to match deep dive exactly
  const getAIMultipliers = (status: string) => {
    const lowerStatus = status.toLowerCase().trim();
    if (lowerStatus.includes("partial")) return orgSettings.aiMultipliers.partial;
    if (lowerStatus.includes("no") || lowerStatus === "" || lowerStatus.includes("not applicable")) return orgSettings.aiMultipliers.none;
    if (lowerStatus.includes("genai") || lowerStatus.includes("native") || lowerStatus.includes("yes")) return orgSettings.aiMultipliers.native;
    return orgSettings.aiMultipliers.none;
  };

  const multipliers = getAIMultipliers(aiStatus);
  
  // Calculate base score
  const calculateBaseScore = () => {
    return Object.values(scoringCriteria).reduce((total, category) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      return total + (numScore * (category.weight / 100) * 2);
    }, 0);
  };

  // Calculate AI score
  const calculateAIScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      return total + (weightedScore * aiMultiplier);
    }, 0);
  };
  
  // Calculate scope score
  const calculateScopeScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      const scopeMultiplier = scopeMultipliers[key as keyof typeof scopeMultipliers] as number;
      return total + (weightedScore * aiMultiplier * scopeMultiplier);
    }, 0);
  };
  
  const baseScore = calculateBaseScore();
  const aiScore = calculateAIScore();
  const scopeScore = calculateScopeScore();
  const genAIAmplification = baseScore > 0 ? aiScore / baseScore : 1.0;
  const scopeAmplification = aiScore > 0 ? scopeScore / aiScore : 1.0;
  const totalAppRiskScore = baseScore * genAIAmplification * scopeAmplification;
  
  return Math.round(totalAppRiskScore * 100) / 100; // Round to 2 decimal places
}

// GET - Optimized AI Risk Analysis endpoint that combines all data fetching and processing
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const orgId = request.cookies.get('orgId')?.value;

    if (!orgId) {
      return NextResponse.json({ 
        success: true, 
        data: [],
        responseTime: Date.now() - startTime 
      });
    }



    console.log(`[PERF] AI Risk Analysis API called for org: ${orgId}`);

    // Check cache first - early return for maximum performance
    const cacheKey = `ai_risk_analysis_${orgId}`;
    const cachedData = getCachedData(cacheKey);
    
    if (cachedData) {
      console.log(`[PERF] ⚡ Cache hit for ${cacheKey}, returning cached data in ${Date.now() - startTime}ms`);
      return NextResponse.json({
        success: true,
        data: cachedData,
        fromCache: true,
        responseTime: Date.now() - startTime
      });
    }

    // Also check for cached organization settings to avoid duplicate queries
    const orgSettingsCacheKey = `org_settings_${orgId}`;
    let cachedOrgSettings = getCachedData(orgSettingsCacheKey);

    // PHASE 1: Fetch applications with user data (same approach as main applications API)
    const appsQueryStart = Date.now();
    
    // Get applications with user data in a single query (same as main applications API)
    const { data: applications, error: applicationsError } = await supabaseAdmin
      .from('applications')
      .select(`
        id,
        name,
        risk_level,
        user_applications:user_applications!inner (
          user:users!inner (
            id
          )
        )
      `)
      .eq('organization_id', orgId);

    if (applicationsError) {
      console.error('Error fetching applications for org:', applicationsError);
      return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 });
    }

    const apps = applications || [];
    
    // Create user count map for efficient lookup
    const userCountMap = new Map<number, number>();
    apps.forEach((app: any) => {
      const uniqueUsers = new Set<string>();
      if (app.user_applications) {
        app.user_applications.forEach((ua: any) => {
          if (ua.user && ua.user.id) {
            uniqueUsers.add(ua.user.id);
          }
        });
      }
      userCountMap.set(app.id, uniqueUsers.size);
    });

    console.log(`[PERF] Applications query completed in ${Date.now() - appsQueryStart}ms (${apps?.length || 0} apps)`);

    if (!apps || apps.length === 0) {
      setCachedData(cacheKey, []);
      return NextResponse.json({ 
        success: true, 
        data: [],
        responseTime: Date.now() - startTime 
      });
    }

    // PHASE 2: Fetch organization settings (with caching)
    const orgSettingsQueryStart = Date.now();
    let orgSettings = getDefaultOrgSettings();
    
    if (cachedOrgSettings) {
      orgSettings = cachedOrgSettings;
      console.log(`[PERF] ⚡ Organization settings cache hit in ${Date.now() - orgSettingsQueryStart}ms`);
    } else {
      try {
        const { data: orgSettingsData, error: orgSettingsError } = await supabaseAdmin
          .from('organization_settings')
          .select('bucket_weights, ai_multipliers, scope_multipliers')
          .eq('organization_id', orgId)
          .single();

        if (orgSettingsData && !orgSettingsError) {
          orgSettings = {
            bucketWeights: orgSettingsData.bucket_weights,
            aiMultipliers: orgSettingsData.ai_multipliers,
            scopeMultipliers: orgSettingsData.scope_multipliers
          };
          // Cache organization settings for future requests
          setCachedData(orgSettingsCacheKey, orgSettings);
        }
      } catch (error) {
        console.warn('Could not fetch org settings, using defaults:', error);
      }
      
      console.log(`[PERF] Organization settings query completed in ${Date.now() - orgSettingsQueryStart}ms`);
    }

    // PHASE 3: Fetch AI risk data with optimized parallel batching
    const aiRiskQueryStart = Date.now();
    const shadowAppNames = apps.map((app: { name: string }) => app.name);
    console.log(`[PERF] Fetching AI risk averages for ${shadowAppNames.length} applications...`);

    const BATCH_SIZE = 300; // Increased batch size for better performance
    const MAX_CONCURRENT_BATCHES = 5; // Limit concurrent requests to avoid overwhelming DB
    let allAIResults: any[] = [];
    
    // Create batches
    const batches = [];
    for (let i = 0; i < shadowAppNames.length; i += BATCH_SIZE) {
      batches.push(shadowAppNames.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`[PERF] Processing ${batches.length} AI risk batches in parallel (max ${MAX_CONCURRENT_BATCHES} concurrent)`);
    
    // Process batches in parallel with concurrency limit
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
      const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_BATCHES);
      const batchPromises = concurrentBatches.map(async (batch, index) => {
        const batchNumber = i + index + 1;
        try {
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
            console.warn(`[PERF] Error in AI risk batch ${batchNumber}:`, batchError);
            return [];
          }
          
          console.log(`[PERF] AI risk batch ${batchNumber} found ${batchResults?.length || 0} matches`);
          return batchResults || [];
        } catch (batchError) {
          console.warn(`[PERF] Exception in AI risk batch ${batchNumber}:`, batchError);
          return [];
        }
      });
      
      // Wait for this set of concurrent batches to complete
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(results => {
        allAIResults.push(...results);
      });
    }

    console.log(`[PERF] AI risk data query completed in ${Date.now() - aiRiskQueryStart}ms`);

    // PHASE 4: Server-side data processing and matching
    const processingStart = Date.now();
    
    // Create lookup maps for efficient matching
    const applicationsMap = new Map();
    apps.forEach((app: any) => {
      const normalizedName = app.name.toLowerCase().trim();
      // Use the actual user count from our optimized query
      const userCount = userCountMap.get(app.id) || 0;
      
      applicationsMap.set(normalizedName, {
        riskLevel: app.risk_level || 'Medium',
        userCount: userCount
      });
    });

    const aiDataMap = new Map();
    allAIResults.forEach(aiData => {
      const normalizedName = aiData['Tool Name']?.toLowerCase().trim();
      if (normalizedName) {
        aiDataMap.set(normalizedName, aiData);
      }
    });

    // Process and calculate final risk scores on server
    const transformedData = Array.from(aiDataMap.entries()).map(([appName, aiData]) => {
      const appData = applicationsMap.get(appName);
      const rawAppRiskScore = parseFloat(aiData["Average 1"] || "0");
      
      // Calculate final risk score on server
      const finalAppRiskScore = calculateFinalRiskScore(aiData, appData, orgSettings);
      const users = appData?.userCount || 0;
      const blastRadius = users * finalAppRiskScore;

      return {
        appName: aiData["Tool Name"] || 'Unknown',
        category: determineCategory(aiData["AI-Native"]),
        scopeRisk: appData?.riskLevel || determineScopeRisk(rawAppRiskScore),
        users: users,
        rawAppRiskScore: rawAppRiskScore,
        finalAppRiskScore: finalAppRiskScore,
        blastRadius: Math.round(blastRadius * 100) / 100,
      };
    });

    // Sort by blast radius (descending)
    const sortedData = transformedData.sort((a, b) => b.blastRadius - a.blastRadius);

    console.log(`[PERF] Server-side processing completed in ${Date.now() - processingStart}ms`);

    // Cache the results for future requests
    setCachedData(cacheKey, sortedData);

    const totalTime = Date.now() - startTime;
    
    // Enhanced performance logging
    console.log(`[PERF] ✅ AI Risk Analysis completed in ${totalTime}ms`);
    console.log(`[PERF] 📊 Processing summary:`);
    console.log(`[PERF]   - Total applications: ${apps.length}`);
    console.log(`[PERF]   - AI risk data matches: ${allAIResults.length}`);
    console.log(`[PERF]   - Final processed apps: ${sortedData.length}`);
    console.log(`[PERF]   - Cache status: MISS (data cached for next request)`);

    return NextResponse.json({
      success: true,
      data: sortedData,
      fromCache: false,
      responseTime: totalTime,
      metadata: {
        totalApps: apps.length,
        aiRiskMatches: allAIResults.length,
        processedApps: sortedData.length,
        optimizations: [
          'Parallel application & user count queries',
          'Concurrent AI risk data batching',
          'Server-side risk calculations',
          'Organization settings caching',
          '5-minute result caching'
        ]
      }
    });

  } catch (error) {
    console.error('Error in ai-risk-analysis route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime
    }, { status: 500 });
  }
} 