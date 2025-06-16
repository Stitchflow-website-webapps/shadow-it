import { supabaseAdmin } from '@/lib/supabase';

// Required admin scopes for Google Workspace
export const GOOGLE_ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.domain.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.security'
];

// Required admin scopes for Microsoft
export const MICROSOFT_ADMIN_SCOPES = [
  'https://graph.microsoft.com/Directory.Read.All',
  'https://graph.microsoft.com/User.Read.All',
  'https://graph.microsoft.com/Application.Read.All'
];

export interface AdminTokens {
  access_token: string;
  refresh_token: string;
  user_email: string;
  scope: string;
}

/**
 * Retrieves admin-scoped tokens for background sync operations
 * @param organizationId - The organization ID to search for
 * @param userEmail - Optional specific user email to filter by
 * @param provider - 'google' or 'microsoft'
 * @returns AdminTokens if found, null otherwise
 */
export async function getAdminScopedTokens(
  organizationId: string, 
  userEmail?: string,
  provider: 'google' | 'microsoft' = 'google'
): Promise<AdminTokens | null> {
  try {
    console.log(`🔍 Fetching admin-scoped tokens for ${provider} org ${organizationId}...`);
    
    let query = supabaseAdmin
      .from('sync_status')
      .select('access_token, refresh_token, user_email, scope')
      .eq('organization_id', organizationId)
      .not('refresh_token', 'is', null) // Ensure we have a refresh token
      .not('scope', 'is', null) // Ensure we have scopes
      .order('created_at', { ascending: false })
      .limit(10); // Get multiple records to find the best one

    // Add user email filter if provided
    if (userEmail) {
      query = query.eq('user_email', userEmail);
    }

    const { data: syncTokens, error: syncError } = await query;

    if (syncError || !syncTokens || syncTokens.length === 0) {
      console.error(`❌ Could not find any tokens in sync_status for ${provider} org ${organizationId}. Error:`, syncError?.message);
      return null;
    }

    // Find the best admin-scoped token from the results
    const requiredAdminScopes = provider === 'google' ? GOOGLE_ADMIN_SCOPES : MICROSOFT_ADMIN_SCOPES;

    for (const token of syncTokens) {
      if (!token.refresh_token || !token.access_token || !token.scope) continue;
      
      // Check if this token has admin scopes
      const tokenScopes = token.scope.split(' ');
      const hasRequiredAdminScopes = requiredAdminScopes.every(scope => 
        tokenScopes.includes(scope)
      );
      
      if (hasRequiredAdminScopes) {
        console.log(`✅ Found admin-scoped tokens for ${provider} org ${organizationId}`, {
          userEmail: token.user_email,
          hasRefresh: !!token.refresh_token,
          hasAccess: !!token.access_token,
          scopeCount: tokenScopes.length
        });
        
        return {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          user_email: token.user_email,
          scope: token.scope
        };
      }
    }

    console.error(`❌ Could not find admin-scoped tokens for ${provider} org ${organizationId}`);
    console.error(`Available tokens:`, syncTokens.map(t => ({
      userEmail: t.user_email,
      hasRefresh: !!t.refresh_token,
      hasAccess: !!t.access_token,
      scopes: t.scope
    })));
    
    return null;
  } catch (error) {
    console.error(`Error fetching admin-scoped tokens:`, error);
    return null;
  }
}

/**
 * Validates if a token has the required admin scopes
 * @param tokenScope - The scope string from the token
 * @param provider - 'google' or 'microsoft'
 * @returns boolean indicating if token has admin scopes
 */
export function hasAdminScopes(tokenScope: string, provider: 'google' | 'microsoft' = 'google'): boolean {
  if (!tokenScope) return false;
  
  const tokenScopes = tokenScope.split(' ');
  const requiredAdminScopes = provider === 'google' ? GOOGLE_ADMIN_SCOPES : MICROSOFT_ADMIN_SCOPES;
  
  return requiredAdminScopes.every(scope => tokenScopes.includes(scope));
}

/**
 * Updates sync_status with new tokens after a refresh
 * @param syncId - The sync_status record ID to update
 * @param accessToken - New access token
 * @param refreshToken - New refresh token (optional)
 */
export async function updateSyncTokens(
  syncId: string, 
  accessToken: string, 
  refreshToken?: string
): Promise<void> {
  try {
    const updateData: any = {
      access_token: accessToken,
      updated_at: new Date().toISOString()
    };
    
    if (refreshToken) {
      updateData.refresh_token = refreshToken;
    }
    
    await supabaseAdmin
      .from('sync_status')
      .update(updateData)
      .eq('id', syncId);
      
    console.log(`✅ Updated sync_status ${syncId} with refreshed tokens`);
  } catch (error) {
    console.error(`❌ Error updating sync_status ${syncId} with tokens:`, error);
  }
} 