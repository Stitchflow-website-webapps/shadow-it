import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { determineRiskLevel } from '@/lib/risk-assessment';

export const maxDuration = 3600; // 1 hour max duration
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CPU-optimized configuration for stress testing
const CPU_STRESS_CONFIG = {
  MAX_CONCURRENT_OPERATIONS: 1, // Sequential only for single CPU
  BATCH_SIZE: 25, // Optimized batch size
  DELAY_BETWEEN_BATCHES: 100, // Reduced delay for stress testing
  MAX_TOKENS_PER_BATCH: 75,
  DB_OPERATION_DELAY: 50,
  MEMORY_CLEANUP_INTERVAL: 150,
};

// Realistic scopes for simulated OAuth tokens - based on common real-world applications
const SIMULATED_TOKEN_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly'
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to force garbage collection and cleanup
function forceMemoryCleanup() {
  if (global.gc) {
    global.gc();
  }
}

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  return await supabaseAdmin
    .from('sync_status')
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', syncId);
}

// Simulate token processing with multiplied data
async function simulateTokenProcessing(
  organizationId: string,
  syncId: string,
  multiplier: number,
  baselineData: any,
  accessToken: string,
  refreshToken: string
) {
  console.log(`🧪 [CPU STRESS] Starting simulated token processing with ${multiplier}x multiplier`);
  
  // Simulate the computational load without actual API calls
  const simulatedUsers = baselineData.users * multiplier;
  const simulatedApps = baselineData.applications * multiplier;
  const simulatedTokens = baselineData.userAppRelations * multiplier;
  
  await updateSyncStatus(syncId, 10, `🧪 CPU STRESS: Processing ${simulatedUsers} users, ${simulatedApps} apps, ${simulatedTokens} tokens`);
  
  // Simulate memory-intensive operations that would happen in real token processing
  console.log(`🧪 [CPU STRESS] Simulating ${simulatedTokens} token operations...`);
  
  const tokenBatchSize = CPU_STRESS_CONFIG.MAX_TOKENS_PER_BATCH;
  const totalBatches = Math.ceil(simulatedTokens / tokenBatchSize);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * tokenBatchSize;
    const batchEnd = Math.min(batchStart + tokenBatchSize, simulatedTokens);
    const currentBatchSize = batchEnd - batchStart;
    
    // Simulate processing each token in the batch
    const simulatedTokenBatch = [];
    for (let i = 0; i < currentBatchSize; i++) {
      // Create realistic token simulation with memory allocation
      // Using more realistic scopes that would be found in actual OAuth tokens
      const simulatedToken = {
        id: `simulated_token_${batchStart + i}`,
        displayText: `SimulatedApp_${Math.floor((batchStart + i) / 10)}`,
        userKey: `simulated_user_${Math.floor(Math.random() * simulatedUsers)}`,
        scopes: SIMULATED_TOKEN_SCOPES,
        clientId: `client_${Math.floor(Math.random() * 100)}`,
        userId: `user_${Math.floor(Math.random() * simulatedUsers)}`
      };
      
      // Simulate risk assessment computation
      const riskLevel = determineRiskLevel(simulatedToken.scopes);
      
      simulatedTokenBatch.push({
        ...simulatedToken,
        riskLevel,
        processedAt: new Date().toISOString()
      });
    }
    
    // Simulate grouping by application (CPU-intensive operation)
    const appGroups = new Map();
    for (const token of simulatedTokenBatch) {
      const appName = token.displayText;
      if (!appGroups.has(appName)) {
        appGroups.set(appName, []);
      }
      appGroups.get(appName).push(token);
    }
    
    // Simulate processing each app group
    for (const [appName, tokens] of appGroups.entries()) {
      // Simulate scope aggregation and risk analysis
      const allScopes = new Set();
      tokens.forEach((token: any) => {
        token.scopes.forEach((scope: string) => allScopes.add(scope));
      });
      
      // Simulate database operations (without actually writing)
      await sleep(CPU_STRESS_CONFIG.DB_OPERATION_DELAY);
    }
    
    // Update progress
    const progress = 10 + Math.floor((batchIndex / totalBatches) * 80);
    await updateSyncStatus(
      syncId, 
      progress, 
      `🧪 CPU STRESS: Processed batch ${batchIndex + 1}/${totalBatches} (${currentBatchSize} tokens)`
    );
    
    // Memory cleanup every N operations
    if (batchIndex % CPU_STRESS_CONFIG.MEMORY_CLEANUP_INTERVAL === 0) {
      forceMemoryCleanup();
    }
    
    // Delay between batches
    await sleep(CPU_STRESS_CONFIG.DELAY_BETWEEN_BATCHES);
    
    // Clear batch data to prevent memory buildup
    simulatedTokenBatch.length = 0;
    appGroups.clear();
  }
  
  console.log(`✅ [CPU STRESS] Completed simulation of ${simulatedTokens} token operations`);
}

export async function POST(request: NextRequest) {
  let sync_id: string | undefined;
  
  try {
    const body = await request.json();
    const {
      organization_id,
      access_token,
      refresh_token,
      simulation_multiplier,
      baseline_data,
      provider = 'google'
    } = body;
    
    sync_id = body.sync_id; // Extract sync_id for error handling

    console.log(`🧪 [CPU STRESS] Starting CPU stress test for org ${organization_id} with ${simulation_multiplier}x multiplier`);
    
    if (!organization_id || !sync_id || !access_token || !simulation_multiplier || !baseline_data) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Log initial memory state
    const startMemory = process.memoryUsage();
    console.log('🧪 [CPU STRESS] Initial memory:', {
      heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`
    });

    // Initialize Google service for token refresh testing
    const googleService = new GoogleWorkspaceService({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    });

    await googleService.setCredentials({
      access_token,
      refresh_token,
      scope: [
        'openid',
        'profile',
        'email',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.security',
        // // Also include token readonly scope, which is essential for the sync
        // 'https://www.googleapis.com/auth/admin.directory.token.readonly'
      ].join(' ')
    });

    // Test token refresh under stress
    await updateSyncStatus(sync_id, 5, '🧪 CPU STRESS: Testing token refresh under load...');
    
    try {
      const refreshedTokens = await googleService.refreshAccessToken(true);
      if (refreshedTokens) {
        console.log(`✅ [CPU STRESS] Token refresh successful under stress conditions`);
        
        // Update sync_status with refreshed tokens
        await supabaseAdmin
          .from('sync_status')
          .update({
            access_token: refreshedTokens.access_token,
            refresh_token: refreshedTokens.refresh_token,
            updated_at: new Date().toISOString()
          })
          .eq('id', sync_id);
      }
    } catch (refreshError: any) {
      console.error(`❌ [CPU STRESS] Token refresh failed:`, refreshError);
      throw new Error(`Token refresh failed during stress test: ${refreshError.message}`);
    }

    // Simulate the main token processing workload
    await simulateTokenProcessing(
      organization_id,
      sync_id,
      simulation_multiplier,
      baseline_data,
      access_token,
      refresh_token
    );

    // Final memory check
    const endMemory = process.memoryUsage();
    const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;
    
    console.log('🧪 [CPU STRESS] Final memory:', {
      heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`,
      increase: `${Math.round(memoryIncrease / 1024 / 1024)}MB`
    });

    // Determine if memory usage is acceptable
    const memoryEfficiency = memoryIncrease < (100 * 1024 * 1024) ? 'EXCELLENT' : 
                            memoryIncrease < (200 * 1024 * 1024) ? 'GOOD' : 
                            memoryIncrease < (500 * 1024 * 1024) ? 'ACCEPTABLE' : 'NEEDS_OPTIMIZATION';

    await updateSyncStatus(
      sync_id, 
      100, 
      `🧪 CPU STRESS TEST COMPLETED: ${simulation_multiplier}x load, memory efficiency: ${memoryEfficiency}`,
      'COMPLETED'
    );

    return NextResponse.json({
      success: true,
      message: `CPU stress test completed successfully`,
      simulation: {
        multiplier: simulation_multiplier,
        simulatedUsers: baseline_data.users * simulation_multiplier,
        simulatedApps: baseline_data.applications * simulation_multiplier,
        simulatedTokens: baseline_data.userAppRelations * simulation_multiplier
      },
      performance: {
        memoryUsage: {
          start: startMemory,
          end: endMemory,
          increase: memoryIncrease,
          efficiency: memoryEfficiency
        },
        cpuOptimizations: [
          'Sequential processing (single CPU)',
          'Controlled batch sizes',
          'Memory cleanup intervals',
          'Optimized delays',
          'Token refresh under load'
        ]
      },
      testResults: {
        tokenRefreshWorking: true,
        memoryLeakDetected: memoryIncrease > (500 * 1024 * 1024),
        cpuOptimizationEffective: memoryEfficiency !== 'NEEDS_OPTIMIZATION',
        recommendedForProduction: memoryEfficiency === 'EXCELLENT' || memoryEfficiency === 'GOOD'
      }
    });

  } catch (error: any) {
    console.error('❌ [CPU STRESS] Error in CPU stress test:', error);
    
    // Update sync status to failed
    if (request && sync_id) {
      await updateSyncStatus(
        sync_id,
        0,
        `🧪 CPU STRESS TEST FAILED: ${error.message}`,
        'FAILED'
      );
    }
    
    return NextResponse.json({
      success: false,
      error: 'CPU stress test failed',
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
} 