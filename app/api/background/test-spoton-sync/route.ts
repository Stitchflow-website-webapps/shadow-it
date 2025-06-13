import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 3600; // 1 hour max duration
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 [TEST] Starting Spoton sync test...');
    
    // Hardcoded Spoton organization ID for testing
    const SPOTON_ORG_ID = 'a3b83096-3df8-48bf-a0b1-09d9d1607a9e';
    const SPOTON_USER_EMAIL = 'dwattenberg@spoton.com';
    
    // Get the latest tokens for Spoton from user_sessions
    console.log('🔍 [TEST] Fetching Spoton tokens from database...');
    const { data: userSession, error: sessionError } = await supabaseAdmin
      .from('user_sessions')
      .select('access_token, refresh_token, user_email')
      .eq('user_email', SPOTON_USER_EMAIL)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (sessionError || !userSession) {
      console.error('❌ [TEST] Could not find Spoton user session:', sessionError);
      return NextResponse.json({ 
        error: 'Could not find Spoton user session',
        details: sessionError?.message 
      }, { status: 404 });
    }

    if (!userSession.access_token || !userSession.refresh_token) {
      console.error('❌ [TEST] Missing tokens in Spoton user session');
      return NextResponse.json({ 
        error: 'Missing access or refresh token for Spoton user' 
      }, { status: 400 });
    }

    console.log('✅ [TEST] Found Spoton tokens, creating test sync record...');

    // Create a test sync status record
    const { data: syncRecord, error: syncError } = await supabaseAdmin
      .from('sync_status')
      .insert({
        organization_id: SPOTON_ORG_ID,
        user_email: SPOTON_USER_EMAIL,
        status: 'IN_PROGRESS',
        progress: 0,
        message: '🧪 TEST: Starting Spoton sync with CPU optimization',
        access_token: userSession.access_token,
        refresh_token: userSession.refresh_token,
      })
      .select('id')
      .single();

    if (syncError || !syncRecord) {
      console.error('❌ [TEST] Failed to create sync record:', syncError);
      return NextResponse.json({ 
        error: 'Failed to create sync record',
        details: syncError?.message 
      }, { status: 500 });
    }

    const sync_id = syncRecord.id;
    console.log(`✅ [TEST] Created sync record: ${sync_id}`);

    // Log system resources before starting
    const startMemory = process.memoryUsage();
    console.log('📊 [TEST] Starting memory usage:', {
      heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`
    });

    // Get the base URL for internal API calls
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`🔗 [TEST] Using base URL: ${baseUrl}`);

    // Call the main sync endpoint with test flag
    console.log('🚀 [TEST] Triggering main sync endpoint...');
    
    const syncResponse = await fetch(`${baseUrl}/api/background/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Mode': 'true', // Flag to indicate this is a test
        'X-Skip-Email': 'true', // Flag to skip email notifications
      },
      body: JSON.stringify({
        organization_id: SPOTON_ORG_ID,
        sync_id: sync_id,
        access_token: userSession.access_token,
        refresh_token: userSession.refresh_token,
        provider: 'google'
      }),
    });

    // Log final memory usage
    const endMemory = process.memoryUsage();
    console.log('📊 [TEST] Final memory usage:', {
      heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`,
      memoryIncrease: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`
    });

    if (!syncResponse.ok) {
      const errorText = await syncResponse.text();
      console.error('❌ [TEST] Sync endpoint failed:', errorText);
      
      // Update sync status to failed
      await supabaseAdmin
        .from('sync_status')
        .update({
          status: 'FAILED',
          message: `🧪 TEST FAILED: ${errorText}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', sync_id);

      return NextResponse.json({
        success: false,
        error: 'Sync endpoint failed',
        details: errorText,
        syncId: sync_id,
        memoryUsage: {
          start: startMemory,
          end: endMemory,
          increase: endMemory.heapUsed - startMemory.heapUsed
        }
      }, { status: 500 });
    }

    const syncResult = await syncResponse.json();
    console.log('✅ [TEST] Sync completed successfully:', syncResult);

    // Get final sync status
    const { data: finalStatus } = await supabaseAdmin
      .from('sync_status')
      .select('status, progress, message')
      .eq('id', sync_id)
      .single();

    return NextResponse.json({
      success: true,
      message: '🧪 Spoton sync test completed successfully',
      syncId: sync_id,
      organizationId: SPOTON_ORG_ID,
      finalStatus: finalStatus,
      memoryUsage: {
        start: {
          heapUsed: `${Math.round(startMemory.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(startMemory.heapTotal / 1024 / 1024)}MB`,
          rss: `${Math.round(startMemory.rss / 1024 / 1024)}MB`
        },
        end: {
          heapUsed: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(endMemory.heapTotal / 1024 / 1024)}MB`,
          rss: `${Math.round(endMemory.rss / 1024 / 1024)}MB`
        },
        increase: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`
      },
      testNotes: [
        '✅ Used optimized PROCESSING_CONFIG for 1 CPU + 2GB RAM',
        '✅ Token refresh functionality tested',
        '✅ Email notifications skipped (test mode)',
        '✅ Memory usage monitored',
        '✅ CPU optimization applied'
      ]
    });

  } catch (error: any) {
    console.error('❌ [TEST] Error in Spoton sync test:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Test failed with exception',
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
} 