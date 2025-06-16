import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 3600; // 1 hour max duration
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 [CPU TEST] Starting CPU optimization test...');
    
    // Parse request body to get org details
    const body = await request.json();
    const {
      organization_id,
      user_email,
      simulation_multiplier = 10 // Default to 10x the data
    } = body;
    
    if (!organization_id || !user_email) {
      return NextResponse.json({ 
        error: 'Missing required parameters',
        required: ['organization_id', 'user_email'],
        received: { organization_id, user_email }
      }, { status: 400 });
    }
    
    console.log(`🔍 [CPU TEST] Testing with org: ${organization_id}, user: ${user_email}, multiplier: ${simulation_multiplier}x`);
    
    // Get the latest ADMIN-SCOPED tokens for the test org from sync_status
    console.log('🔍 [CPU TEST] Fetching admin tokens from sync_status...');
    const { data: syncStatus, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .select('access_token, refresh_token, user_email')
      .eq('organization_id', organization_id)
      .eq('user_email', user_email)
      .not('refresh_token', 'is', null) // Ensure we have a refresh token
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (syncError || !syncStatus) {
      console.error('❌ [CPU TEST] Could not find admin tokens in sync_status:', syncError);
      return NextResponse.json({ 
        error: 'Could not find admin-scoped tokens in sync_status',
        details: 'The user needs to complete the admin consent flow first. Only admin-scoped tokens can run the background sync.',
        suggestion: `Have ${user_email} log in with admin consent at https://stitchflow.com/tools/shadow-it-scan/`,
        debugInfo: syncError?.message 
      }, { status: 404 });
    }

    if (!syncStatus.access_token || !syncStatus.refresh_token) {
      console.error('❌ [CPU TEST] Missing admin tokens in sync_status');
      return NextResponse.json({ 
        error: 'Missing admin access or refresh token',
        details: 'The sync_status record exists but lacks proper admin tokens.'
      }, { status: 400 });
    }

    // Get current org data to understand the baseline
    console.log('📊 [CPU TEST] Analyzing current organization data...');
    const { data: existingUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organization_id', organization_id);
      
    const { data: existingApps, error: appsError } = await supabaseAdmin
      .from('applications')
      .select('id')
      .eq('organization_id', organization_id);
      
    const { data: existingTokens, error: tokensError } = await supabaseAdmin
      .from('user_applications')
      .select('id')
      .eq('organization_id', organization_id);

    if (usersError || appsError || tokensError) {
      console.error('❌ [CPU TEST] Error fetching existing data:', { usersError, appsError, tokensError });
      return NextResponse.json({ error: 'Failed to analyze existing data' }, { status: 500 });
    }

    const baseline = {
      users: existingUsers?.length || 0,
      applications: existingApps?.length || 0,
      userAppRelations: existingTokens?.length || 0
    };

    console.log('📊 [CPU TEST] Baseline data:', baseline);
    console.log(`🚀 [CPU TEST] Will simulate ${simulation_multiplier}x load:`, {
      simulatedUsers: baseline.users * simulation_multiplier,
      simulatedApps: baseline.applications * simulation_multiplier,
      simulatedRelations: baseline.userAppRelations * simulation_multiplier
    });

    console.log('✅ [CPU TEST] Found admin tokens, creating test sync record...');
    console.log('🔍 [CPU TEST] Admin token info:', {
      hasAccessToken: !!syncStatus.access_token,
      hasRefreshToken: !!syncStatus.refresh_token,
      accessTokenLength: syncStatus.access_token?.length || 0,
      refreshTokenLength: syncStatus.refresh_token?.length || 0,
      accessTokenPrefix: syncStatus.access_token?.substring(0, 20) + '...',
      refreshTokenPrefix: syncStatus.refresh_token?.substring(0, 20) + '...',
      userEmail: syncStatus.user_email
    });

    // Create a test sync status record
    const { data: syncRecord, error: syncRecordError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: organization_id,
        user_email: syncStatus.user_email,
        status: 'IN_PROGRESS',
        progress: 0,
        message: `🧪 CPU TEST: Starting ${simulation_multiplier}x load simulation (${baseline.users * simulation_multiplier} users, ${baseline.applications * simulation_multiplier} apps)`,
        access_token: syncStatus.access_token,
        refresh_token: syncStatus.refresh_token,
      })
      .select('id')
      .single();

    if (syncRecordError || !syncRecord) {
      console.error('❌ [CPU TEST] Failed to create sync record:', syncRecordError);
      return NextResponse.json({ 
        error: 'Failed to create sync record',
        details: syncRecordError?.message 
      }, { status: 500 });
    }

    const sync_id = syncRecord.id;
    console.log(`✅ [CPU TEST] Created sync record: ${sync_id}`);

    // Log system resources before starting
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    console.log('📊 [CPU TEST] Starting resources:', {
      time: new Date().toISOString(),
      memory: {
        heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`
      }
    });

    // Get the base URL for internal API calls
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`🔗 [CPU TEST] Using base URL: ${baseUrl}`);

    // Call a custom CPU stress test endpoint instead of the normal sync
    console.log('🚀 [CPU TEST] Triggering CPU stress test endpoint...');
    
    const stressTestResponse = await fetch(`${baseUrl}/api/background/cpu-stress-test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Mode': 'true',
        'X-Skip-Email': 'true',
        'X-CPU-Test': 'true'
      },
      body: JSON.stringify({
        organization_id: organization_id,
        sync_id: sync_id,
        access_token: syncStatus.access_token,
        refresh_token: syncStatus.refresh_token,
        provider: 'google',
        simulation_multiplier: simulation_multiplier,
        baseline_data: baseline
      }),
    });

    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    // Log final resource usage
    console.log('📊 [CPU TEST] Final resources:', {
      duration: `${Math.round(duration / 1000)}s`,
      memory: {
        heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`,
        increase: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`
      }
    });

    if (!stressTestResponse.ok) {
      const errorText = await stressTestResponse.text();
      console.error('❌ [CPU TEST] Stress test failed:', errorText);
      
      // Update sync status to failed
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: `🧪 CPU TEST FAILED: ${errorText}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', sync_id);

      return NextResponse.json({
        success: false,
        error: 'CPU stress test failed',
        details: errorText,
        syncId: sync_id,
        baseline: baseline,
        simulation: {
          multiplier: simulation_multiplier,
          simulatedLoad: {
            users: baseline.users * simulation_multiplier,
            applications: baseline.applications * simulation_multiplier,
            relations: baseline.userAppRelations * simulation_multiplier
          }
        },
        performance: {
          duration: `${Math.round(duration / 1000)}s`,
          memoryUsage: {
            start: startMemory,
            end: endMemory,
            increase: endMemory.heapUsed - startMemory.heapUsed
          }
        }
      }, { status: 500 });
    }

    const stressTestResult = await stressTestResponse.json();
    console.log('✅ [CPU TEST] Stress test completed successfully:', stressTestResult);

    // Get final sync status
    const { data: finalStatus } = await supabaseAdmin
      .from('sync_status')
      .select('status, progress, message')
      .eq('id', sync_id)
      .single();

    return NextResponse.json({
      success: true,
      message: `🧪 CPU optimization test completed successfully (${simulation_multiplier}x load)`,
      syncId: sync_id,
      organizationId: organization_id,
      baseline: baseline,
      simulation: {
        multiplier: simulation_multiplier,
        simulatedLoad: {
          users: baseline.users * simulation_multiplier,
          applications: baseline.applications * simulation_multiplier,
          relations: baseline.userAppRelations * simulation_multiplier
        }
      },
      performance: {
        duration: `${Math.round(duration / 1000)}s`,
        peakMemoryUsage: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
        memoryIncrease: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`,
        memoryEfficiency: endMemory.heapUsed < startMemory.heapUsed * 3 ? 'GOOD' : 'NEEDS_OPTIMIZATION'
      },
      finalStatus: finalStatus,
      cpuOptimizations: [
        '✅ Single CPU sequential processing',
        '✅ Controlled batch sizes (25 items)',
        '✅ Memory cleanup every 150 operations',
        '✅ Optimized delays (100ms between batches)',
        '✅ Token refresh optimization',
        `✅ Simulated ${simulation_multiplier}x load for stress testing`
      ]
    });

  } catch (error: any) {
    console.error('❌ [CPU TEST] Error in CPU optimization test:', error);
    
    return NextResponse.json({
      success: false,
      error: 'CPU test failed with exception',
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
} 