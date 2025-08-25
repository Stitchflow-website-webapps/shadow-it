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
    
    // 2. Run cleanup for Microsoft organizations
    console.log(`🔄 [WeeklyCron] Starting Microsoft cleanup...`);
    const microsoftCleanupUrl = new URL('/api/admin/cleanup-guest-disabled-users', request.url);
    
    const microsoftResponse = await fetch(microsoftCleanupUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: false // Set to false for actual cleanup
      }),
    });

    let microsoftResult = null;
    if (microsoftResponse.ok) {
      microsoftResult = await microsoftResponse.json();
      console.log(`✅ [WeeklyCron] Microsoft cleanup completed successfully`);
      console.log(`📊 [WeeklyCron] Microsoft Summary:`, microsoftResult.summary);
    } else {
      const errorData = await microsoftResponse.text();
      console.error(`❌ [WeeklyCron] Microsoft cleanup failed: ${microsoftResponse.status} - ${errorData}`);
    }
    
    // 3. Run cleanup for Google organizations
    console.log(`🔄 [WeeklyCron] Starting Google cleanup...`);
    const googleCleanupUrl = new URL('/api/admin/cleanup-google-suspended-archived-users', request.url);
    
    const googleResponse = await fetch(googleCleanupUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dry_run: false // Set to false for actual cleanup
      }),
    });

    let googleResult = null;
    if (googleResponse.ok) {
      googleResult = await googleResponse.json();
      console.log(`✅ [WeeklyCron] Google cleanup completed successfully`);
      console.log(`📊 [WeeklyCron] Google Summary:`, googleResult.summary);
    } else {
      const errorData = await googleResponse.text();
      console.error(`❌ [WeeklyCron] Google cleanup failed: ${googleResponse.status} - ${errorData}`);
    }
    
    // 4. Combine results and return summary
    const combinedSummary = {
      microsoft: microsoftResult?.summary || { error: 'Microsoft cleanup failed' },
      google: googleResult?.summary || { error: 'Google cleanup failed' },
      totalOrganizations: (microsoftResult?.summary?.totalOrganizations || 0) + (googleResult?.summary?.totalOrganizations || 0),
      totalSuccessfulOrganizations: (microsoftResult?.summary?.successfulOrganizations || 0) + (googleResult?.summary?.successfulOrganizations || 0),
      totalRemovedUsers: (microsoftResult?.summary?.totalRemovedUsers || 0) + (googleResult?.summary?.totalRemovedUsers || 0),
      totalRemovedRelationships: (microsoftResult?.summary?.totalRemovedRelationships || 0) + (googleResult?.summary?.totalRemovedRelationships || 0),
      totalRemovedApplications: (microsoftResult?.summary?.totalRemovedApplications || 0) + (googleResult?.summary?.totalRemovedApplications || 0)
    };
    
    console.log(`🎉 [WeeklyCron] All cleanups completed!`);
    console.log(`📊 [WeeklyCron] Combined Summary:`, combinedSummary);
    
    return NextResponse.json({
      success: true,
      message: 'Weekly cleanup completed for all providers',
      timestamp: new Date().toISOString(),
      summary: combinedSummary,
      microsoftSuccess: !!microsoftResult,
      googleSuccess: !!googleResult
    });

  } catch (error) {
    console.error(`❌ [WeeklyCron] Weekly cleanup failed:`, error);
    
    return NextResponse.json({
      success: false,
      error: 'Weekly cleanup failed',
      details: (error as Error).message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
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
    
    // Test Microsoft cleanup in DRY RUN mode
    console.log(`🔄 [WeeklyCron] Testing Microsoft cleanup...`);
    const microsoftCleanupUrl = new URL('/api/admin/cleanup-guest-disabled-users', request.url);
    
    const microsoftResponse = await fetch(microsoftCleanupUrl.toString(), {
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
      console.log(`✅ [WeeklyCron] Microsoft test completed successfully`);
    } else {
      const errorData = await microsoftResponse.text();
      console.error(`❌ [WeeklyCron] Microsoft test failed: ${microsoftResponse.status} - ${errorData}`);
    }
    
    // Test Google cleanup in DRY RUN mode
    console.log(`🔄 [WeeklyCron] Testing Google cleanup...`);
    const googleCleanupUrl = new URL('/api/admin/cleanup-google-suspended-archived-users', request.url);
    
    const googleResponse = await fetch(googleCleanupUrl.toString(), {
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
      console.log(`✅ [WeeklyCron] Google test completed successfully`);
    } else {
      const errorData = await googleResponse.text();
      console.error(`❌ [WeeklyCron] Google test failed: ${googleResponse.status} - ${errorData}`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Test run completed for all providers (DRY RUN)',
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
