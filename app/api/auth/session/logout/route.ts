import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  console.log('[LOGOUT API] Starting logout process...');
  
  try {
    // Get the session ID from the cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    console.log('[LOGOUT API] Session ID found:', !!sessionId);

    if (sessionId) {
      try {
        // Delete the session from the database
        const { error } = await supabaseAdmin
          .from('user_sessions')
          .delete()
          .eq('id', sessionId);
        
        if (error) {
          console.error('[LOGOUT API] Database session deletion error:', error);
          // Continue with cookie clearing even if database deletion fails
        } else {
          console.log('[LOGOUT API] Database session deleted successfully');
        }
      } catch (dbError) {
        console.error('[LOGOUT API] Database error during session deletion:', dbError);
        // Continue with cookie clearing even if database operation fails
      }
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

    // Clear all authentication-related cookies with comprehensive options
    const cookiesToClear = [
      'shadow_session_id',
      'orgId', 
      'userEmail', 
      'user_info',
      'accessToken',
      'refreshToken',
      'session_token',
      'auth_token'
    ];

    for (const cookieName of cookiesToClear) {
      // Clear cookie with various path and domain combinations for thorough cleanup
      response.cookies.set(cookieName, '', {
        expires: new Date(0),
        path: '/',
        httpOnly: cookieName === 'shadow_session_id', // Keep httpOnly for session cookie
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
      
      // Also try clearing with empty path
      response.cookies.set(cookieName, '', {
        expires: new Date(0),
        path: '',
        httpOnly: cookieName === 'shadow_session_id',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
    }

    console.log('[LOGOUT API] Cookies cleared, logout successful');
    return response;
    
  } catch (error) {
    console.error('[LOGOUT API] Error during logout:', error);
    
    // Even if there's an error, still try to clear cookies
    const errorResponse = NextResponse.json({
      success: false,
      message: 'Error occurred during logout, but cookies will still be cleared'
    }, { status: 500 });

    // Add CORS headers to error response as well
    errorResponse.headers.set('Access-Control-Allow-Origin', '*');
    errorResponse.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    errorResponse.headers.set('Access-Control-Allow-Credentials', 'true');

    // Still clear cookies even on error
    const cookiesToClear = [
      'shadow_session_id',
      'orgId', 
      'userEmail', 
      'user_info',
      'accessToken',
      'refreshToken'
    ];

    for (const cookieName of cookiesToClear) {
      errorResponse.cookies.set(cookieName, '', {
        expires: new Date(0),
        path: '/',
        httpOnly: cookieName === 'shadow_session_id',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
    }

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