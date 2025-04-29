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
    '/api/background/sync',
    '/api/background/sync/google',
    '/api/background/sync/microsoft',
    '/api/background/sync/tokens',
    '/api/background/sync/users',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/sync',
    '/api/background/sync/users',
    '/api/background/sync/tokens',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/sync/microsoft',
    '/api/background/sync/google',
    '/api/categorize',  // Add the categorization API
    '/loading',
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
  
  // Just check for the presence of user_info cookie for now
  const userInfo = request.cookies.get('orgId')?.value;
  const isAuthenticated = !!userInfo || isInternalApiCall;
  
  console.log('isAuthenticated:', isAuthenticated, 'isPublicRoute:', isPublicRoute, 'isInternalApiCall:', isInternalApiCall);
  
  // // // Redirect logic
  // if (!isAuthenticated && !isPublicRoute) {
  //   // Redirect to login page if not authenticated and trying to access protected route
  //   return NextResponse.redirect(new URL('/login', request.url));
  // }
  
  if (isAuthenticated && request.nextUrl.pathname === '/login' && !isInternalApiCall) {
    // Redirect to home page if already authenticated and trying to access login page
    return NextResponse.redirect(new URL(`/?orgId=${request.cookies.get('orgId')?.value}`, request.url));
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
  
  // Check if user is authenticated for protected routes
  if (pathname.startsWith('') &&
      !pathname.startsWith('/login') &&
      !pathname.startsWith('/api/')) {
    
    // No cookies or missing orgId means user is not authenticated
    if (!request.cookies.has('user_info') || !request.cookies.has('orgId')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    // If there's no orgId parameter in the URL, redirect to the main page with the orgId
    if (!request.nextUrl.searchParams.has('orgId') && pathname === '') {
      return NextResponse.redirect(new URL(`/?orgId=${request.cookies.get('orgId')?.value}`, request.url));
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