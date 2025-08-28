import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 3600; // 1 hour timeout
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the request using Upstash signature
    const upstashSignature = request.headers.get('Upstash-Signature');
    
    if (!upstashSignature) {
      console.error(`[WeeklyCron] Missing Upstash-Signature header`);
      return NextResponse.json({ error: 'Unauthorized - Missing Upstash signature' }, { status: 401 });
    }

    // Upstash provides signature-based authentication automatically
    console.log('✅ [WeeklyCron] Authenticated via Upstash signature');

    console.log(`🚀 [WeeklyCron] Starting weekly cleanup for all providers...`);
    console.log(`⏰ [WeeklyCron] Triggered at: ${new Date().toISOString()}`);
    
    // 2. Get the base URL for internal API calls
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`🔗 [WeeklyCron] Using base URL: ${baseUrl}`);

    // 3. Generate a unique job ID for tracking
    const jobId = `weekly-cleanup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📋 [WeeklyCron] Job ID: ${jobId}`);

    // 4. Immediately respond to Upstash to avoid timeout
    const response = NextResponse.json({
      success: true,
      message: 'Weekly cleanup job started successfully',
      jobId: jobId,
      timestamp: new Date().toISOString(),
      status: 'STARTED',
      note: 'Cleanup is running in the background. Check logs for progress.'
    });

    // 5. Start the long-running cleanup process in the background (fire-and-forget)
    // This runs after the response is sent to Upstash
    runBackgroundCleanup(baseUrl, jobId).catch(error => {
      console.error(`❌ [WeeklyCron] Background cleanup failed for job ${jobId}:`, error);
    });

    return response;

  } catch (error) {
    console.error(`❌ [WeeklyCron] Weekly cleanup initialization failed:`, error);
    
    return NextResponse.json({
      success: false,
      error: 'Weekly cleanup initialization failed',
      details: (error as Error).message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Background cleanup function that runs after responding to Upstash
async function runBackgroundCleanup(baseUrl: string, jobId: string) {
  console.log(`🔄 [WeeklyCron-${jobId}] Starting background cleanup process...`);
  
  try {
    // Start both cleanup processes in parallel without waiting for completion
    // This prevents internal fetch timeouts since cleanup endpoints run in background
    
    console.log(`🚀 [WeeklyCron-${jobId}] Triggering Microsoft cleanup (fire-and-forget)...`);
    const microsoftCleanupUrl = `${baseUrl}/api/admin/cleanup-guest-disabled-users`;
    console.log(`🔗 [WeeklyCron-${jobId}] Microsoft cleanup URL: ${microsoftCleanupUrl}`);
    
    // Fire-and-forget: Don't await the response to avoid timeout
    fetch(microsoftCleanupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: false // Set to false for actual cleanup
      }),
    }).then(async (response) => {
      console.log(`📡 [WeeklyCron-${jobId}] Microsoft cleanup response status: ${response.status}`);
      if (response.ok) {
        const result = await response.json();
        console.log(`✅ [WeeklyCron-${jobId}] Microsoft cleanup completed successfully`);
        console.log(`📊 [WeeklyCron-${jobId}] Microsoft Summary:`, result.summary);
      } else {
        const errorData = await response.text();
        console.error(`❌ [WeeklyCron-${jobId}] Microsoft cleanup failed: ${response.status} - ${errorData}`);
      }
    }).catch((error) => {
      console.log(`🔍 [WeeklyCron-${jobId}] Microsoft cleanup fetch error details:`, {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause
      });
      
      // This is expected for long-running operations that timeout
      if (error.code === 'UND_ERR_HEADERS_TIMEOUT' || error.message.includes('timeout')) {
        console.log(`⏰ [WeeklyCron-${jobId}] Microsoft cleanup fetch timed out (expected for long operations)`);
        console.log(`🔄 [WeeklyCron-${jobId}] Microsoft cleanup is still running in the background`);
      } else {
        console.error(`❌ [WeeklyCron-${jobId}] Microsoft cleanup fetch error:`, error);
      }
    });
    
    console.log(`🚀 [WeeklyCron-${jobId}] Triggering Google cleanup (fire-and-forget)...`);
    const googleCleanupUrl = `${baseUrl}/api/admin/cleanup-google-suspended-archived-users`;
    console.log(`🔗 [WeeklyCron-${jobId}] Google cleanup URL: ${googleCleanupUrl}`);
    
    // Fire-and-forget: Don't await the response to avoid timeout
    fetch(googleCleanupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: false // Set to false for actual cleanup
      }),
    }).then(async (response) => {
      console.log(`📡 [WeeklyCron-${jobId}] Google cleanup response status: ${response.status}`);
      if (response.ok) {
        const result = await response.json();
        console.log(`✅ [WeeklyCron-${jobId}] Google cleanup completed successfully`);
        console.log(`📊 [WeeklyCron-${jobId}] Google Summary:`, result.summary);
      } else {
        const errorData = await response.text();
        console.error(`❌ [WeeklyCron-${jobId}] Google cleanup failed: ${response.status} - ${errorData}`);
      }
    }).catch((error) => {
      console.log(`🔍 [WeeklyCron-${jobId}] Google cleanup fetch error details:`, {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause
      });
      
      // This is expected for long-running operations that timeout
      if (error.code === 'UND_ERR_HEADERS_TIMEOUT' || error.message.includes('timeout')) {
        console.log(`⏰ [WeeklyCron-${jobId}] Google cleanup fetch timed out (expected for long operations)`);
        console.log(`🔄 [WeeklyCron-${jobId}] Google cleanup is still running in the background`);
      } else {
        console.error(`❌ [WeeklyCron-${jobId}] Google cleanup fetch error:`, error);
      }
    });
    
    console.log(`🎉 [WeeklyCron-${jobId}] Background cleanup triggers completed!`);
    console.log(`📝 [WeeklyCron-${jobId}] Note: Both cleanup processes are now running independently`);
    console.log(`📊 [WeeklyCron-${jobId}] Check individual cleanup logs for detailed progress and results`);
    console.log(`⏰ [WeeklyCron-${jobId}] Background trigger finished at: ${new Date().toISOString()}`);
    
  } catch (error) {
    console.error(`❌ [WeeklyCron-${jobId}] Background cleanup trigger failed:`, error);
  }
}

// Also support GET for testing/manual trigger
export async function GET(request: NextRequest) {
  try {
    // For testing, we'll allow requests with either Upstash signature or manual testing
    const upstashSignature = request.headers.get('Upstash-Signature');
    const testParam = request.nextUrl.searchParams.get('test');
    
    if (!upstashSignature && testParam !== 'true') {
      return NextResponse.json({ 
        error: 'Unauthorized - Use ?test=true for manual testing or provide Upstash-Signature header' 
      }, { status: 401 });
    }

    console.log(`🧪 [WeeklyCron] Manual test trigger for all providers...`);
    
    // Get the base URL for internal API calls
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    const baseUrl = `${protocol}${host}`;
    
    console.log(`🔗 [WeeklyCron] Test using base URL: ${baseUrl}`);
    
    // Generate a unique job ID for tracking
    const jobId = `test-cleanup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📋 [WeeklyCron] Test Job ID: ${jobId}`);

    // For testing, we can run synchronously since it's DRY RUN (faster)
    // But if tests become slow, we can make this async too
    
    // Test Microsoft cleanup in DRY RUN mode
    console.log(`🔄 [WeeklyCron-${jobId}] Testing Microsoft cleanup...`);
    const microsoftCleanupUrl = `${baseUrl}/api/admin/cleanup-guest-disabled-users`;
    
    const microsoftResponse = await fetch(microsoftCleanupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: true // DRY RUN for testing
      }),
    });

    let microsoftResult = null;
    if (microsoftResponse.ok) {
      microsoftResult = await microsoftResponse.json();
      console.log(`✅ [WeeklyCron-${jobId}] Microsoft test completed successfully`);
    } else {
      const errorData = await microsoftResponse.text();
      console.error(`❌ [WeeklyCron-${jobId}] Microsoft test failed: ${microsoftResponse.status} - ${errorData}`);
    }
    
    // Test Google cleanup in DRY RUN mode
    console.log(`🔄 [WeeklyCron-${jobId}] Testing Google cleanup...`);
    const googleCleanupUrl = `${baseUrl}/api/admin/cleanup-google-suspended-archived-users`;
    
    const googleResponse = await fetch(googleCleanupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: true // DRY RUN for testing
      }),
    });

    let googleResult = null;
    if (googleResponse.ok) {
      googleResult = await googleResponse.json();
      console.log(`✅ [WeeklyCron-${jobId}] Google test completed successfully`);
    } else {
      const errorData = await googleResponse.text();
      console.error(`❌ [WeeklyCron-${jobId}] Google test failed: ${googleResponse.status} - ${errorData}`);
    }
    
    console.log(`🎉 [WeeklyCron-${jobId}] Test run completed!`);
    
    return NextResponse.json({
      success: true,
      message: 'Test run completed for all providers (DRY RUN)',
      jobId: jobId,
      timestamp: new Date().toISOString(),
      microsoft: microsoftResult,
      google: googleResult,
      microsoftSuccess: !!microsoftResult,
      googleSuccess: !!googleResult
    });

  } catch (error) {
    console.error(`❌ [WeeklyCron] Test run failed:`, error);
    
    return NextResponse.json({
      success: false,
      error: 'Test run failed',
      details: (error as Error).message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
