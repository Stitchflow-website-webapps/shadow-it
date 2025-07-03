import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This function runs on every request
export function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Skip auth check for public routes and internal API calls
  const publicRoutes = [
    '/login',
    '/api/auth/google',
    '/api/auth/microsoft',
    '/api/auth/session/create',
    '/api/auth/session/validate',
    '/api/auth/session/refresh',
    '/api/auth/session/logout',
    '/api/background/sync',
    '/api/background/sync/google',
    '/api/background/sync/microsoft',
    '/api/background/sync/tokens',
    '/api/background/sync/users',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/check-notifications',
    '/api/background/sync',
    '/api/background/sync/users',
    '/api/background/sync/tokens',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/sync/microsoft',
    '/api/background/sync/google',
    '/api/categorize',  // Add the categorization API
    '/loading',
    '/api/user',
    '/api/session-info', // Add the new session-info API
    '/api/sync/status',
    '/favicon.ico',
    '/images',  // Add images directory
    '/.*\\.(?:jpg|jpeg|gif|png|svg|ico|css|js)$'
  ];
  
  // Check if current URL is a public route
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route)
  );
  
  // Check for internal API calls with service role key
  const isInternalApiCall = request.headers.get('Authorization')?.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  
  // Check for session cookie instead of direct orgId cookie
  const hasSessionCookie = request.cookies.has('shadow_session_id');
  const hasLegacyAuthCookie = request.cookies.has('orgId');
  const isAuthenticated = hasSessionCookie || hasLegacyAuthCookie || isInternalApiCall;
  
  console.log('isAuthenticated:', isAuthenticated, 'isPublicRoute:', isPublicRoute, 'isInternalApiCall:', isInternalApiCall);
  
  // // // Redirect logic
  // if (!isAuthenticated && !isPublicRoute) {
  //   // Redirect to login page if not authenticated and trying to access protected route
  //   return NextResponse.redirect(new URL('/login', request.url));
  // }
  
  if (isAuthenticated && request.nextUrl.pathname === '/login' && !isInternalApiCall) {
    // Redirect to home page if already authenticated and trying to access login page
    return NextResponse.redirect(new URL(`/`, request.url));
  }
  
  // Check if the request is for the shadow-it-scan API
  const pathname = request.nextUrl.pathname;
  
  if (pathname.startsWith('/api/categorization/status')) {
    // Create a new URL for the rewritten endpoint
    const url = new URL(request.url);
    // Change the pathname to the actual API endpoint
    url.pathname = `/api/categorization/status`;
    // Keep the query parameters
    
    return NextResponse.rewrite(url);
  }
  
  // Add rewrite for session-info endpoint
  if (pathname.startsWith('/api/session-info')) {
    const url = new URL(request.url);
    url.pathname = `/api/session-info`;
    
    // Forward cookies in the request
    const response = NextResponse.rewrite(url);
    return response;
  }
  
  // Check if user is authenticated for protected routes
  if (pathname.startsWith('') &&
      !pathname.startsWith('/login') &&
      !pathname.startsWith('/api/')) {
    
    // Check for the new session cookie first, then fallback to legacy cookies
    if (!hasSessionCookie && !hasLegacyAuthCookie) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }
  
  // Continue with the request
  return NextResponse.next();
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
    '/api/categorization/status/:path*',
  ],
}; 