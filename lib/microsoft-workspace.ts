import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { ClientSecretCredential } from '@azure/identity';
import { supabaseAdmin } from '@/lib/supabase';

// Define interfaces for Microsoft API responses
interface Token {
  clientId: string;
  displayText?: string;
  scopes?: string[];
  userKey: string;
  userEmail?: string;
  lastTimeUsed?: string;
  assignedDate?: string;    // When the user was assigned to the application
  lastSignInDateTime?: string; // When the user last signed in
  assignmentType?: string;  // Direct or inherited assignment
  // Fields for risk assessment
  adminScopes?: string[];   // Admin-consented permissions
  userScopes?: string[];    // User-consented permissions
  appRoleScopes?: string[]; // App role permissions
  permissionCount?: number; // Total number of unique permissions
  highRiskPermissions?: string[]; // Permissions that are considered high risk
  mediumRiskPermissions?: string[]; // Permissions that are considered medium risk
  [key: string]: any;
}

interface MicrosoftGraphUser {
  id: string;
  mail: string;
  displayName: string;
  userPrincipalName?: string;
  lastSignInDateTime?: string;
}

interface ServicePrincipalResponse {
  value: Array<{
    id: string;
    appId: string;
    displayName: string;
    appRoles?: Array<{
      id: string;
      value: string;
      displayName: string;
      description: string;
    }>;
    oauth2PermissionScopes?: Array<{
      id: string;
      value: string;
      adminConsentDisplayName: string;
      adminConsentDescription: string;
    }>;
  }>;
}

interface OAuth2Grant {
  principalId: string;
  clientId: string;
  resourceId: string;
  scope?: string;
  startTime?: string;
  createdTime?: string;
}

export class MicrosoftWorkspaceService {
  private client: Client;
  private credential: ClientSecretCredential;
  private clientId: string;
  private clientSecret: string;
  private tenantId: string;
  private currentTokens: any = null;

  constructor(credentials: any) {
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.tenantId = credentials.tenantId;
    
    // Default to 'common' if no tenant ID is provided or it's empty/undefined
    if (!this.tenantId) {
      console.warn('No tenant ID provided, defaulting to "organizations"');
      this.tenantId = 'organizations';
    }
    
    // Log tenant ID for debugging
    console.log(`Creating Microsoft client with tenant ID: "${this.tenantId}"`);
    
    this.credential = new ClientSecretCredential(
      this.tenantId,
      this.clientId,
      this.clientSecret
    );

    const authProvider = new TokenCredentialAuthenticationProvider(this.credential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    this.client = Client.initWithMiddleware({
      authProvider: authProvider
    });
  }

  async setCredentials(tokens: any) {
    // Store the tokens
    this.currentTokens = tokens;
    
    // For Microsoft, we'll use the access token directly with the client
    this.client = Client.init({
      authProvider: (done) => {
        done(null, tokens.access_token);
      }
    });
  }

  getCredentials() {
    return this.currentTokens;
  }

  /**
   * Refreshes a token using a refresh token
   * @param refreshToken The refresh token to use
   * @returns Object with the new tokens
   */
  async refreshToken(refreshToken: string) {
    try {
      console.log('Refreshing Microsoft token with refresh token');
      
      // Prepare the token endpoint request
      const tokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/.default offline_access'
      });

      // Make the refresh token request
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Failed to refresh Microsoft token:', errorData);
        throw new Error(`Failed to refresh token: ${response.status} ${response.statusText} - ${errorData}`);
      }

      // Parse the new tokens
      const newTokens = await response.json();
      
      // Return the token response with properly named fields
      return {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || refreshToken, // Keep original if not returned
        id_token: newTokens.id_token,
        expires_in: newTokens.expires_in || 3600 // Default to 1 hour
      };
    } catch (error) {
      console.error('Error refreshing Microsoft token:', error);
      throw error;
    }
  }

  /**
   * Refreshes the access token using the refresh token
   * @param force If true, forces a token refresh regardless of expiry status
   * @returns Object with the new tokens or null if refresh wasn't needed/possible
   */
  async refreshAccessToken(force = false) {
    try {
      // Check if we have a refresh token
      if (!this.currentTokens || !this.currentTokens.refresh_token) {
        console.error('No refresh token available for Microsoft, cannot refresh');
        throw new Error('Missing Microsoft refresh token - unable to refresh access token');
      }

      // Check if token is expired or we're forcing a refresh
      const now = Date.now();
      const isExpired = !this.currentTokens.expires_at || now >= this.currentTokens.expires_at;
      
      if (!force && !isExpired) {
        console.log('Microsoft access token still valid, no refresh needed');
        return null;
      }

      if (force) {
        console.log('Forcing Microsoft token refresh as requested');
      } else {
        console.log('Microsoft access token expired, refreshing...');
      }
      
      try {
        // Use 'common' tenant for token refresh to avoid tenant-specific issues
        const tokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
        const params = new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.currentTokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default offline_access'
        });

        console.log('Making token refresh request to Microsoft...');
        
        // Make the refresh token request
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('Failed to refresh Microsoft token:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          });
          
          // Parse error details if possible
          try {
            const errorJson = JSON.parse(errorData);
            if (errorJson.error === 'invalid_grant') {
              throw new Error(`Microsoft refresh token has expired or been revoked. User needs to re-authenticate. Error: ${errorJson.error_description || errorData}`);
            }
          } catch (parseError) {
            // If we can't parse the error, use the raw text
          }
          
          throw new Error(`Failed to refresh Microsoft token: ${response.status} ${response.statusText} - ${errorData}`);
        }

        // Parse the new tokens
        const newTokens = await response.json();
        
        if (!newTokens.access_token) {
          throw new Error('No access token received in refresh response');
        }
        
        // Merge with existing tokens, ensuring we keep the refresh token if not returned
        const updatedTokens = {
          ...this.currentTokens,
          access_token: newTokens.access_token,
          id_token: newTokens.id_token || this.currentTokens.id_token,
          refresh_token: newTokens.refresh_token || this.currentTokens.refresh_token,
          expires_at: Date.now() + ((newTokens.expires_in || 3600) * 1000),
          token_type: newTokens.token_type || 'Bearer'
        };
        
        // Update the stored tokens
        this.currentTokens = updatedTokens;
        
        // Reinitialize the Microsoft Graph client with the new access token
        this.client = Client.init({
          authProvider: (done) => {
            done(null, updatedTokens.access_token);
          }
        });
        
        console.log('Successfully refreshed Microsoft access token and updated client');
        return updatedTokens;
      } catch (refreshError) {
        console.error('Detailed Microsoft token refresh error:', refreshError);
        
        // Add more context to the error
        if (refreshError instanceof Error) {
          // Check for common OAuth errors and provide better messages
          if (refreshError.message.includes('invalid_grant')) {
            throw new Error(`Invalid Microsoft refresh token. OAuth grant has expired or been revoked. User needs to re-authenticate: ${refreshError.message}`);
          } else if (refreshError.message.includes('AADSTS70008')) {
            throw new Error(`Microsoft refresh token has expired. User needs to re-authenticate: ${refreshError.message}`);
          } else if (refreshError.message.includes('AADSTS')) {
            throw new Error(`Microsoft Azure AD error: ${refreshError.message}`);
          } else {
            throw new Error(`Microsoft token refresh failed: ${refreshError.message}`);
          }
        }
        
        throw refreshError; // Re-throw any other errors
      }
    } catch (error) {
      console.error('Error in Microsoft refreshAccessToken:', error);
      throw error;
    }
  }

  async getToken(code: string) {
    // Exchange authorization code for tokens
    const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI!,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to get tokens from Microsoft');
    }

    return response.json();
  }

  async getAuthenticatedUserInfo() {
    const response = await this.client.api('/me').get();
    return response;
  }

  async getUsersList() {
    // Return a list of users, filtering out any without an email
    const users = await this.getAllPages<MicrosoftGraphUser>('/users?$select=id,mail,displayName,userPrincipalName');
    return users.filter(user => user.mail);
  }

  private async getAllPages<T>(endpoint: string, select?: string): Promise<T[]> {
    let allItems: T[] = [];
    let nextLink: string | undefined = endpoint;

    while (nextLink) {
      try {
        const response: any = await this.client.api(nextLink).get();
        allItems = allItems.concat(response.value);
        nextLink = response['@odata.nextLink'];
      } catch (error) {
        console.error(`Error fetching page for endpoint ${endpoint}:`, error);
        // Depending on the error, you might want to break or handle it differently
        // For now, we stop pagination on error to prevent infinite loops on persistent failures
        break;
      }
    }
    return allItems;
  }

  /**
   * Fetches all service principals (applications) from the tenant.
   * @returns A promise that resolves to an array of service principal objects.
   */
  async getServicePrincipals(): Promise<any[]> {
    console.log('Fetching all service principals from Microsoft Graph API...');
    // We select only the necessary fields to reduce payload size.
    const endpoint = '/servicePrincipals?$select=id,appId,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType';
    const servicePrincipals = await this.getAllPages(endpoint);
    console.log(`Successfully fetched ${servicePrincipals.length} service principals.`);
    return servicePrincipals;
  }

  /**
   * Fetches all OAuth2 permission grants for the entire tenant.
   * This represents the permissions (scopes) that users have granted to applications.
   * @returns A promise that resolves to an array of OAuth2 permission grant objects.
   */
  async getAllOAuth2PermissionGrants(): Promise<any[]> {
    console.log('Fetching all OAuth2 permission grants from Microsoft Graph API...');
    const endpoint = '/oauth2PermissionGrants';
    const grants = await this.getAllPages(endpoint);
    console.log(`Successfully fetched ${grants.length} OAuth2 permission grants.`);
    return grants;
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      console.log('Fetching OAuth tokens from Microsoft Graph API...');

      // 1. Get all service principals (applications) in the tenant
      const servicePrincipals = await this.getServicePrincipals();
      const spMap = new Map(servicePrincipals.map(sp => [sp.id, { appId: sp.appId, displayName: sp.displayName, appRoles: sp.appRoles || [] }]));
      const spAppIdMap = new Map(servicePrincipals.map(sp => [sp.appId, { id: sp.id, displayName: sp.displayName, appRoles: sp.appRoles || [] }]));

      // 2. Get all delegated permission grants (user-consented or admin-consented for a user)
      const oauthGrants = await this.getAllOAuth2PermissionGrants();
      
      // 3. Get all application permission grants (app roles assigned to users)
      const appRoleAssignments = await this.getAllAppRoleAssignments();
      
      console.log(`Fetched ${oauthGrants.length} delegated grants and ${appRoleAssignments.length} app role assignments.`);

      const userAppTokens = new Map<string, Token>(); // Key: userPrincipalId:appId

      // Process delegated permissions
      for (const grant of oauthGrants) {
        if (!grant.principalId || !grant.clientId) continue;

        const sp = spAppIdMap.get(grant.clientId);
        if (!sp) continue; // Skip grants for apps not in the tenant

        const key = `${grant.principalId}:${grant.clientId}`;
        if (!userAppTokens.has(key)) {
          userAppTokens.set(key, {
            userKey: grant.principalId,
            clientId: grant.clientId,
            displayText: sp.displayName,
            scopes: []
          });
        }
        
        const token = userAppTokens.get(key)!;
        if (grant.scope) {
          token.scopes!.push(...grant.scope.split(' ').filter((s: any) => s));
        }
      }

      // Process application permissions
      for (const assignment of appRoleAssignments) {
        if (!assignment.principalId || !assignment.resourceId) continue;

        const sp = spMap.get(assignment.resourceId);
        if (!sp) continue; // Skip assignments for resources not in the tenant
        
        // Find the specific role that was assigned
        const assignedRole = sp.appRoles.find((role: any) => role.id === assignment.appRoleId);
        const roleName = assignedRole ? assignedRole.value || assignedRole.displayName : 'Unknown Role';
        if (!roleName) continue; // Skip if role has no name

        const key = `${assignment.principalId}:${sp.appId}`;
        
        if (!userAppTokens.has(key)) {
          userAppTokens.set(key, {
            userKey: assignment.principalId,
            clientId: sp.appId,
            displayText: sp.displayName,
            scopes: []
          });
        }
        
        const token = userAppTokens.get(key)!;
        // Prefix with 'AppRole:' to distinguish from delegated scopes
        token.scopes!.push(`AppRole: ${roleName}`);
      }

      const results = Array.from(userAppTokens.values()).map(token => ({
        ...token,
        scopes: Array.from(new Set(token.scopes)) // De-duplicate scopes
      }));

      console.log(`Successfully processed and combined into ${results.length} unique user-app tokens.`);
      return results;

    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      return [];
    }
  }

  // Get all app role assignments for users
  async getAllAppRoleAssignments(): Promise<any[]> {
    return this.getAllPages('/users?$expand=appRoleAssignments');
  }

  async createUserAppRelationship(appId: string, token: any, organizationId: string) {
    try {
      // Get user by email or Microsoft user ID
      let { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('organization_id', organizationId)
        .or(`email.eq.${token.userEmail},microsoft_user_id.eq.${token.userKey}`)
        .single();

      if (userError) {
        console.error('❌ Error finding user:', userError);
        return;
      }

      if (!userData) {
        console.log(`⚠️ No user found for email: ${token.userEmail}. Creating new user record.`);
        
        // Create user if they don't exist
        const { data: newUser, error: createError } = await supabaseAdmin
          .from('users')
          .insert({
            organization_id: organizationId,
            microsoft_user_id: token.userKey,
            email: token.userEmail,
            name: token.userEmail.split('@')[0],
            role: 'User',
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (createError) {
          console.error('❌ Error creating user:', createError);
          return;
        }
        
        userData = newUser;
      }

      // First, check if there's an existing relationship we need to update
      const { data: existingRelationship, error: relationshipError } = await supabaseAdmin
        .from('user_applications')
        .select('id, scopes')
        .eq('user_id', userData.id)
        .eq('application_id', appId)
        .single();

      // Store the user-application relationship with permissions (scopes)
      console.log(`📝 Storing permissions for user ${token.userEmail} and app ${token.displayText || appId}`);
      console.log(`   Scopes: ${token.scopes ? JSON.stringify(token.scopes) : 'None'}`);
      
      if (existingRelationship) {
        // If relationship exists, merge the scopes and update
        console.log(`   ℹ️ Existing relationship found, merging scopes`);
        const existingScopes = existingRelationship.scopes || [];
        const mergedScopes = [...new Set([...existingScopes, ...(token.scopes || [])])];
        
        const { error: updateError } = await supabaseAdmin
          .from('user_applications')
          .update({
            scopes: mergedScopes,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRelationship.id);

        if (updateError) {
          console.error('❌ Error updating user-application relationship:', updateError);
        } else {
          console.log(`✅ Successfully updated app-user relationship with ${mergedScopes.length} permissions`);
        }
      } else {
        console.log(`   ℹ️ Creating new user-application relationship`);
        // Create new relationship
        const { error: insertError } = await supabaseAdmin
          .from('user_applications')
          .upsert({
            user_id: userData.id,
            application_id: appId,
            scopes: token.scopes || [],
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,application_id',
            ignoreDuplicates: true
          });

        if (insertError) {
          console.error('❌ Error creating user-application relationship:', insertError);
          console.error('   Details:', insertError.details);
          console.error('   Message:', insertError.message);
        } else {
          console.log(`✅ Successfully created app-user relationship with ${token.scopes?.length || 0} permissions`);
        }
      }
    } catch (error) {
      console.error('❌ Error in createUserAppRelationship:', error);
    }
  }
}

// Helper function to classify Microsoft Graph permissions by risk level
function classifyPermissionRisk(permission: string): 'high' | 'medium' | 'low' {
  // High risk permissions - full admin access or write permissions
  const highRiskPatterns = [
    'ReadWrite.All',
    'Write.All',
    '.ReadWrite',
    '.Write',
    'FullControl.All',
    'AccessAsUser.All',
    'Directory.ReadWrite',
    'Files.ReadWrite',
    'Mail.ReadWrite',
    'Mail.Send',
    'Group.ReadWrite',
    'User.ReadWrite',
    'Application.ReadWrite',
    'Sites.FullControl',
    'User.Export',
    'User.Invite',
    'User.ManageIdentities',
    'User.EnableDisableAccount',
    'DelegatedPermissionGrant.ReadWrite'
  ];

  // Medium risk permissions - read access to sensitive data
  const mediumRiskPatterns = [
    'Read.All',
    '.Read',
    'Directory.Read',
    'Files.Read',
    'User.Read.All',
    'Mail.Read',
    'AuditLog.Read',
    'Reports.Read',
    'Sites.Read'
  ];

  // Check for high risk first
  for (const pattern of highRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'high';
    }
  }

  // Then check for medium risk
  for (const pattern of mediumRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'medium';
    }
  }

  // Default to low risk
  return 'low';
} 