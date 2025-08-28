/**
 * Unified authentication utilities for consistent sign-out behavior across all pages
 */

export interface SignOutOptions {
  /** Whether to show login modal after sign-out (for main page) */
  showLoginModal?: boolean;
  /** Custom redirect URL after sign-out */
  redirectUrl?: string;
  /** Callback to set login modal state */
  setShowLoginModal?: (show: boolean) => void;
  /** Whether to suppress error notifications */
  suppressErrors?: boolean;
}

/**
 * Unified sign-out function that works consistently across all pages
 */
export async function signOut(options: SignOutOptions = {}) {
  const {
    showLoginModal = false,
    redirectUrl = '/',
    setShowLoginModal,
    suppressErrors = false
  } = options;

  try {
    console.log('[AUTH] Starting sign-out process...');

    // Step 1: Call server-side logout API
    const response = await fetch('/api/auth/session/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      console.log('[AUTH] Server-side logout successful');
    } else {
      console.error('[AUTH] Server-side logout failed:', response.status);
      if (!suppressErrors) {
        // Don't throw error, continue with client-side cleanup
        console.warn('[AUTH] Continuing with client-side cleanup despite server error');
      }
    }
  } catch (error) {
    console.error('[AUTH] Logout API error:', error);
    if (!suppressErrors) {
      console.warn('[AUTH] Continuing with client-side cleanup despite API error');
    }
  }

  // Step 2: Always perform comprehensive client-side cleanup
  if (typeof window !== 'undefined') {
    console.log('[AUTH] Starting client-side cleanup...');

    try {
      // Get all existing cookies for logging
      const allCookies = document.cookie.split(';');
      console.log('[AUTH] Cookies before clearing:', allCookies.length);

      // Define cookies to clear
      const cookiesToClear = [
        'orgId', 
        'userEmail', 
        'accessToken', 
        'refreshToken', 
        'shadow_session_id', 
        'user_info',
        'session_token', // Additional common cookie names
        'auth_token',
        'jwt_token'
      ];

      // Define domain and path combinations to try
      const currentDomain = window.location.hostname;
      const domains = [
        '', // Default (current domain)
        currentDomain,
        `.${currentDomain}`,
        'stitchflow.io',
        '.stitchflow.io',
        'manage.stitchflow.io',
        '.manage.stitchflow.io'
      ];
      
      const paths = ['/', '', '/app', '/api'];

      // Clear specific cookies with all domain/path combinations
      for (const cookieName of cookiesToClear) {
        for (const domain of domains) {
          for (const path of paths) {
            try {
              const domainStr = domain ? `; domain=${domain}` : '';
              const pathStr = path ? `; path=${path}` : '';
              const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
              const sameSiteStr = '; samesite=lax';
              
              // Set cookie to expire in the past
              document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}${secureStr}${sameSiteStr}`;
            } catch (cookieError) {
              // Ignore individual cookie clearing errors
              console.debug(`[AUTH] Failed to clear cookie ${cookieName} with domain ${domain} and path ${path}`);
            }
          }
        }
      }

      // Also try to clear all existing cookies generically
      allCookies.forEach((cookie: string) => {
        const cookieName = cookie.trim().split('=')[0];
        if (cookieName) {
          try {
            for (const domain of domains) {
              for (const path of paths) {
                const domainStr = domain ? `; domain=${domain}` : '';
                const pathStr = path ? `; path=${path}` : '';
                const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
                const sameSiteStr = '; samesite=lax';
                
                document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}${secureStr}${sameSiteStr}`;
              }
            }
          } catch (cookieError) {
            console.debug(`[AUTH] Failed to clear existing cookie ${cookieName}`);
          }
        }
      });

      // Clear storage
      try {
        localStorage.clear();
        console.log('[AUTH] Local storage cleared');
      } catch (storageError) {
        console.warn('[AUTH] Failed to clear local storage:', storageError);
      }

      try {
        sessionStorage.clear();
        console.log('[AUTH] Session storage cleared');
      } catch (storageError) {
        console.warn('[AUTH] Failed to clear session storage:', storageError);
      }

      // Log final cookie state
      console.log('[AUTH] Cookies after clearing:', document.cookie.split(';').length);
      console.log('[AUTH] Client-side cleanup completed');

    } catch (cleanupError) {
      console.error('[AUTH] Client-side cleanup failed:', cleanupError);
      if (!suppressErrors) {
        console.warn('[AUTH] Some cleanup operations failed, but continuing...');
      }
    }

    // Step 3: Handle post-logout navigation
    try {
      if (showLoginModal && setShowLoginModal) {
        console.log('[AUTH] Showing login modal');
        setShowLoginModal(true);
      } else {
        console.log(`[AUTH] Redirecting to ${redirectUrl}`);
        // Use window.location.href for a clean redirect that clears any remaining state
        window.location.href = redirectUrl;
      }
    } catch (navigationError) {
      console.error('[AUTH] Navigation error:', navigationError);
      // Fallback to main page
      window.location.href = '/';
    }
  }

  console.log('[AUTH] Sign-out process completed');
}

/**
 * Check if user is authenticated by checking for session cookie
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  
  const cookies = document.cookie.split(';');
  const hasSessionCookie = cookies.some(cookie => 
    cookie.trim().startsWith('shadow_session_id=') && 
    cookie.trim().split('=')[1] && 
    cookie.trim().split('=')[1] !== ''
  );
  
  return hasSessionCookie;
}

/**
 * Get current user email from cookies
 */
export function getCurrentUserEmail(): string | null {
  if (typeof window === 'undefined') return null;
  
  const cookies = document.cookie.split(';');
  const emailCookie = cookies.find(cookie => cookie.trim().startsWith('userEmail='));
  return emailCookie ? decodeURIComponent(emailCookie.split('=')[1]) : null;
}

/**
 * Get current organization ID from cookies or URL
 */
export function getCurrentOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  
  // First check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlOrgId = urlParams.get('orgId');
  if (urlOrgId) return urlOrgId;
  
  // Then check cookies
  const cookies = document.cookie.split(';');
  const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
  return orgIdCookie ? orgIdCookie.split('=')[1].trim() : null;
  }