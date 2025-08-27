import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Get the session ID from the cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;

    if (sessionId) {
      // Delete the session from the database
      await supabaseAdmin
        .from('user_sessions')
        .delete()
        .eq('id', sessionId);
    }

    // Create response that clears all cookies
    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    });

    // Add CORS headers for production
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');

    // Clear the session cookie and any other authentication cookies
    response.cookies.delete('shadow_session_id');
    response.cookies.delete('orgId');
    response.cookies.delete('userEmail');
    response.cookies.delete('user_info');

    return response;
  } catch (error) {
    console.error('Error during logout:', error);
    const errorResponse = NextResponse.json({
      success: false,
      message: 'Error occurred during logout'
    }, { status: 500 });

    // Add CORS headers to error response as well
    errorResponse.headers.set('Access-Control-Allow-Origin', '*');
    errorResponse.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    errorResponse.headers.set('Access-Control-Allow-Credentials', 'true');

    return errorResponse;
  }
}

// Handle preflight OPTIONS request
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });

  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'true');

  return response;
}