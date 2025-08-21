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
  userType?: string; // "Member", "Guest", or other types
  accountEnabled?: boolean; // Whether the account is enabled
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

  async getUsersList(includeGuests: boolean = false, includeDisabled: boolean = false) {
    // Include userType and accountEnabled in selection for filtering
    const selectFields = 'id,mail,displayName,userPrincipalName,userType,accountEnabled';
    
    let endpoint = `/users?$select=${selectFields}`;
    
    // Build filter conditions
    const filterConditions: string[] = [];
    
    // Filter by user type
    if (!includeGuests) {
      filterConditions.push("userType eq 'Member'");
    }
    
    // Filter by account status
    if (!includeDisabled) {
      filterConditions.push("accountEnabled eq true");
    }
    
    // Apply filters if any exist
    if (filterConditions.length > 0) {
      endpoint += `&$filter=${filterConditions.join(' and ')}`;
    }
    
    console.log(`🔍 Fetching users with endpoint: ${endpoint}`);
    console.log(`📋 Filters: includeGuests=${includeGuests}, includeDisabled=${includeDisabled}`);
    
    const users = await this.getAllPages<MicrosoftGraphUser>(endpoint);
    
    console.log(`✅ Fetched ${users.length} users`);
    
    // Log detailed user type and status breakdown for debugging
    const userBreakdown = users.reduce((acc, user) => {
      const type = user.userType || 'Unknown';
      const enabled = user.accountEnabled ? 'Enabled' : 'Disabled';
      const key = `${type} (${enabled})`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('📊 User breakdown:', userBreakdown);
    
    return users;
  }

  private async getAllPages<T>(endpoint: string, select?: string): Promise<T[]> {
    let result: T[] = [];
    let nextLink: string | undefined = endpoint;

    while (nextLink) {
      try {
        const response: any = await this.client.api(nextLink).get();
        result = result.concat(response.value);
        nextLink = response['@odata.nextLink'];
      } catch (error) {
        console.error(`Error fetching page for endpoint ${endpoint}:`, error);
        // Depending on the error, you might want to break or handle it differently
        // For now, we stop pagination on error to prevent infinite loops on persistent failures
        break;
      }
    }
    return result;
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

  async getOAuthTokens(specificUsers?: any[]): Promise<Token[]> {
    try {
      console.log('🔄 Starting OAuth token fetch from Microsoft Entra ID...');
      
      // 1. Get users (either specific users or all organization members)
      let users: any[];
      if (specificUsers && specificUsers.length > 0) {
        console.log(`👥 Using provided ${specificUsers.length} specific users for token processing...`);
        users = specificUsers;
      } else {
        console.log('👥 Fetching all organization members...');
        // Check environment variables for user filtering preferences
        const includeGuests = process.env.MICROSOFT_INCLUDE_GUESTS === 'true';
        const includeDisabled = process.env.MICROSOFT_INCLUDE_DISABLED === 'true';
        
        users = await this.getUsersList(includeGuests, includeDisabled);
        console.log(`✅ Found ${users.length} users (guests: ${includeGuests ? 'included' : 'excluded'}, disabled: ${includeDisabled ? 'included' : 'excluded'})`);
      }

      // 2. Get all service principals (applications) with pagination
      console.log('🔍 Fetching all service principals (applications)...');
      const servicePrincipals = await this.getAllPages<any>(
        '/servicePrincipals',
        'id,appId,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType'
      );
      
      console.log(`✅ Found ${servicePrincipals.length} service principals`);

      // Filter out system applications that shouldn't be included
      // These are typically infrastructure apps that aren't relevant for Shadow IT discovery
      const systemAppPrefixes: string[] = [
        "Microsoft.",
        "Office 365",
        "SharePoint Online Web Client",
        "Microsoft Office"
      ];
      
      const systemAppIds: string[] = [
        // Add specific app IDs for system applications if known
      ];
      
      const filteredServicePrincipals = servicePrincipals.filter(sp => {
        // Filter out by display name prefix
        const isSystemApp = systemAppPrefixes.some(prefix => 
          sp.displayName && sp.displayName.startsWith(prefix)
        );
        
        // Filter out by specific app ID
        const isBlockedAppId = systemAppIds.includes(sp.appId);
        
        // Keep the app if it's not a system app and not a blocked app ID
        return !isSystemApp && !isBlockedAppId;
      });
      
      console.log(`✅ After filtering system apps, using ${filteredServicePrincipals.length} relevant applications`);

      // Create maps for quick lookups
      const appIdToNameMap = new Map<string, string>();
      const appIdToServicePrincipalIdMap = new Map<string, string>();
      const spIdToAppIdMap = new Map<string, string>();
      filteredServicePrincipals.forEach((sp: any) => {
        appIdToNameMap.set(sp.appId, sp.displayName);
        appIdToServicePrincipalIdMap.set(sp.appId, sp.id);
        spIdToAppIdMap.set(sp.id, sp.appId); // Add mapping from SP ID to App ID
      });

      // Get all OAuth2PermissionGrants - both user and admin consents
      console.log("🔐 Fetching all OAuth2 permission grants...");
      let allOAuth2Grants: any[] = [];
      try {
        const allGrantsResponse = await this.client.api('/oauth2PermissionGrants').filter('consentType eq \'AllPrincipals\'').get();
        if (allGrantsResponse && allGrantsResponse.value) {
          allOAuth2Grants = allGrantsResponse.value;
        }
        console.log(`✅ Found ${allOAuth2Grants.length} total OAuth2 permission grants`);
        
        if (allOAuth2Grants.length > 0) {
          console.log("📝 Sample OAuth2 grant structure:", JSON.stringify(allOAuth2Grants[0], null, 2));
        }
      } catch (error) {
        console.warn("⚠️ Could not fetch all OAuth2 grants:", error);
        allOAuth2Grants = [];
      }

      // Create a map of service principals (by ID) to their admin-consented scopes
      // Admin consent has principalId = null or consentType = 'AllPrincipals'
      const adminConsentedScopesMap = new Map<string, string[]>();
      
      // Create a separate map for Microsoft Graph scopes - DO NOT apply these to all apps
      const microsoftGraphId = '1cb195da-78a4-4ccd-bed9-8ac47e57acbe';
      
      // Create a map to store which clientId (app) is requesting access to which resourceId (API)
      const clientToResourceMap = new Map<string, string>();
            
      console.log("📊 Admin-consented scopes map:", Object.fromEntries(adminConsentedScopesMap));

      const tokens: Token[] = [];
      
      // Process each user
      console.log('🔄 Processing user application permissions...');
      let processedUserCount = 0;
      
      for (const user of users) {
        processedUserCount++;
        const userEmail = user.mail || user.userPrincipalName;
        
        if (!userEmail) {
          console.log(`⚠️ Skipping user with ID ${user.id} - no email address found`);
          continue;
        }

        console.log(`👤 Processing user ${processedUserCount}/${users.length}: ${userEmail}`);

        // 4. Get appRoleAssignments for each user (applications assigned to users)
        console.log(`  📋 Fetching app role assignments for ${userEmail}...`);

        // We'll track direct app assignments explicitly to ensure better mapping
        const userDirectAssignedApps = new Set<string>();

        const appRoleResponse = await this.client.api(`/users/${user.id}/appRoleAssignments`)
          .get();

        const appRolesCount = appRoleResponse?.value?.length || 0;
        console.log(`  ✅ Found ${appRolesCount} app role assignments`);

        // Track all directly assigned applications for this user
        if (appRoleResponse && appRoleResponse.value && appRoleResponse.value.length > 0) {
          for (const role of appRoleResponse.value) {
            if (role.resourceId) {
              userDirectAssignedApps.add(role.resourceId);
            }
          }
          console.log(`  📝 User has direct assignments to ${userDirectAssignedApps.size} applications`);
        }

        // 5. Get OAuth2PermissionGrants for each user (delegated permissions)
        let userOAuth2Grants: any[] = [];
        try {
          // Get delegated permission grants for this user
          console.log(`  🔑 Fetching OAuth permission grants for ${userEmail}...`);
          
          // ONLY get user-specific permission grants - NOT admin consent grants
          // Admin consent doesn't mean the user actually has access to the app
          const userOauthResponse = await this.client.api('/oauth2PermissionGrants')
            .filter(`principalId eq '${user.id}'`)
            .get();
          
          userOAuth2Grants = userOauthResponse?.value || [];
          console.log(`  ✅ Found ${userOAuth2Grants.length} user-specific permission grants`);
          
          // NOTE: We deliberately do NOT include admin consent grants here
          // Admin consent (AllPrincipals) only means the admin approved the app's permissions
          // It does NOT mean every user in the tenant has access to that app
          // User access is determined by appRoleAssignments, not admin consent
          
          console.log(`  📊 Total permission grants to process: ${userOAuth2Grants.length}`);
        } catch (error) {
          console.warn(`  ⚠️ Could not fetch OAuth2 grants for user ${userEmail}:`, error);
          userOAuth2Grants = [];
        }

        // Create a map of resource IDs to their scopes from OAuth grants
        const resourceToScopesMap = new Map<string, string[]>();
        userOAuth2Grants.forEach(grant => {
          if (grant.scope) {
            const scopes = grant.scope.split(' ').filter((s: string) => s.trim() !== '');
            if (grant.resourceId) {
              resourceToScopesMap.set(grant.resourceId, scopes);
            }
          }
        });

        // Process app role assignments for this user
        const processedApps = new Set<string>(); // Track processed app IDs for this user

        if (appRoleResponse && appRoleResponse.value) {
          for (const assignment of appRoleResponse.value) {
            // Get the service principal for this app
            const resourceId = assignment.resourceId;
            
            // Skip null or undefined resource IDs
            if (!resourceId) {
              console.log(`  ⚠️ Skipping assignment with missing resource ID`);
              continue;
            }
            
            // Explicitly add to direct assigned apps set
            userDirectAssignedApps.add(resourceId);
            
            const servicePrincipal = filteredServicePrincipals.find((sp: any) => sp.id === resourceId);
            
            if (!servicePrincipal) {
              console.log(`  ⚠️ Could not find service principal for resource ID ${resourceId}`);
              continue;
            }
            
            const appId = servicePrincipal.appId;
            if (processedApps.has(appId)) continue;
            processedApps.add(appId);
            
            console.log(`  🔹 Processing app: ${servicePrincipal.displayName} (${appId})`);
            
            // Find the assigned role from the service principal's appRoles
            const assignedPermissions = new Set<string>();
            
            // Add role-based permissions
            const assignedRole = servicePrincipal.appRoles?.find(
              (role: any) => role.id === assignment.appRoleId
            );
            
            // Prefer the role.value, but fall back to displayName when value is missing.
            const rolePermissionName = assignedRole?.value || assignedRole?.displayName;

            if (rolePermissionName) {
              assignedPermissions.add(rolePermissionName);
              console.log(`    📌 App role permission: ${rolePermissionName}`);
            } else if (assignment.appRoleId === '00000000-0000-0000-0000-000000000000') {
              // The default assignment (empty role) – give it a generic permission label
              assignedPermissions.add('UserAssignment');
              console.log('    📌 Default user assignment role detected – adding "UserAssignment" permission');
            }
            
            // Look for any delegated permissions for this app
            // First, find all relevant OAuth grants for this app
            // We need to check two cases:
            // 1. Grants where this app is the client (clientId === resourceId)
            // 2. Grants that specifically apply to this user
            
            let delegatedScopes: string[] = [];
            
            // Process all grants related to this app
            for (const grant of userOAuth2Grants) {
              if (!grant.scope) continue;
              
              const scopes = grant.scope.split(' ').filter((s: string) => s.trim() !== '');
              if (scopes.length === 0) continue;
              
              const isForThisApp = grant.clientId === resourceId || grant.resourceId === resourceId;
              const isForThisUser = grant.principalId === user.id;
              
              // Skip if this grant doesn't apply to this app or user
              if (!isForThisApp || !isForThisUser) continue;
              
              // Since we only fetch user-specific grants now, all grants are user consents
              delegatedScopes = [...new Set([...delegatedScopes, ...scopes])];
              console.log(`    🔑 User consent permissions: ${scopes.join(', ')}`);
            }
            
            // Check for admin-consented permissions, but ONLY for apps the user is actually assigned to
            // This ensures we capture admin-granted permissions without creating false user-app relationships
            try {
              // Try to get admin grants by resourceId first (most common case)
              let adminGrantsForApp = await this.client.api('/oauth2PermissionGrants')
                .filter(`consentType eq 'AllPrincipals' and resourceId eq '${resourceId}'`)
                .get();
              
              // If no results, try by clientId (less common but possible)
              if (!adminGrantsForApp?.value?.length) {
                adminGrantsForApp = await this.client.api('/oauth2PermissionGrants')
                  .filter(`consentType eq 'AllPrincipals' and clientId eq '${resourceId}'`)
                  .get();
              }
              
              if (adminGrantsForApp?.value) {
                for (const adminGrant of adminGrantsForApp.value) {
                  if (adminGrant.scope) {
                    const adminScopes = adminGrant.scope.split(' ').filter((s: string) => s.trim() !== '');
                    if (adminScopes.length > 0) {
                      // Only add admin scopes for apps the user is actually assigned to
                      delegatedScopes = [...new Set([...delegatedScopes, ...adminScopes])];
                      console.log(`    🛡️ Admin consent permissions (for assigned app): ${adminScopes.join(', ')}`);
                    }
                  }
                }
              }
            } catch (error) {
              console.warn(`    ⚠️ Could not fetch admin grants for app ${resourceId}:`, error);
            }
            
            // Add all scopes to the permissions set
            delegatedScopes.forEach(scope => {
              assignedPermissions.add(scope);
            });
            
            const allPermissions = Array.from(assignedPermissions);
            console.log(`    📊 Total distinct permissions: ${allPermissions.length}`);
            
            // Classify permissions by risk level
            const highRiskPermissions = allPermissions.filter(p => classifyPermissionRisk(p) === 'high');
            const mediumRiskPermissions = allPermissions.filter(p => classifyPermissionRisk(p) === 'medium');
            
            if (highRiskPermissions.length > 0) {
              console.log(`    ⚠️ High risk permissions: ${highRiskPermissions.join(', ')}`);
            }
            
            tokens.push({
              clientId: appId,
              displayText: servicePrincipal.displayName,
              userKey: user.id,
              userEmail: userEmail,
              scopes: allPermissions,
              // Store individual permission types for risk assessment
              adminScopes: [], // No longer tracking separate admin scopes
              userScopes: delegatedScopes,
              appRoleScopes: assignedRole?.value ? [assignedRole.value] : [],
              permissionCount: allPermissions.length,
              highRiskPermissions: highRiskPermissions,
              mediumRiskPermissions: mediumRiskPermissions,
              lastTimeUsed: assignment.createdDateTime || new Date().toISOString(),
              assignedDate: assignment.createdDateTime || new Date().toISOString(),
              assignmentType: 'AppRole',
              lastSignInDateTime: user.lastSignInDateTime || undefined
            });
          }
        }
        
        // Process OAuth2 permission grants that weren't covered by app role assignments
        for (const grant of userOAuth2Grants) {
          // Try to get servicePrincipal by clientId first, then by resourceId
          const clientId = grant.clientId;
          
          // Skip if we already processed this app for this user
          if (processedApps.has(clientId)) continue;
          
          // If this is a clientId we found in a service principal, use it
          const servicePrincipal = filteredServicePrincipals.find((sp: any) => sp.id === clientId || sp.appId === clientId);
          if (!servicePrincipal) {
            console.log(`  ⚠️ Could not find service principal for client ID ${clientId}`);
            continue;
          }
          
          // Add this app to processed list
          const appId = servicePrincipal.appId;
          processedApps.add(appId);
          
          console.log(`  🔹 Processing OAuth app: ${servicePrincipal.displayName} (${appId})`);
          
          // Get user-consented scopes
          const userScopes = grant.scope && !grant.consentType ? grant.scope.split(' ').filter((s: string) => s.trim() !== '') : [];
          if (userScopes.length > 0) {
            console.log(`    🔑 User consent permissions: ${userScopes.join(', ')}`);
          }
          
          // ONLY process user-specific grants - NOT admin consent grants
          // Admin consent grants should only be processed when the user has actual app role assignments
          const isForThisUser = grant.principalId === user.id;
          
          // Skip if this grant doesn't apply to this user (only process user-specific grants)
          if (!isForThisUser) continue;
          
          // Use only user-consented scopes
          const allScopes = userScopes;
          
          // Skip if there are no scopes
          if (allScopes.length === 0) {
            console.log(`    ⚠️ No user consent permissions found for this app`);
            continue;
          }
          
          console.log(`    📊 Total distinct permissions: ${allScopes.length}`);
          
          // Classify permissions by risk level
          const highRiskPermissions = allScopes.filter((p: string) => classifyPermissionRisk(p) === 'high');
          const mediumRiskPermissions = allScopes.filter((p: string) => classifyPermissionRisk(p) === 'medium');
          
          if (highRiskPermissions.length > 0) {
            console.log(`    ⚠️ High risk permissions: ${highRiskPermissions.join(', ')}`);
          }
          
          tokens.push({
            clientId: appId,
            displayText: servicePrincipal.displayName || appIdToNameMap.get(appId) || appId,
            userKey: user.id,
            userEmail: userEmail,
            scopes: allScopes,
            // Store individual permission types for risk assessment
            adminScopes: [], // No admin scopes for OAuth grants
            userScopes: userScopes,
            appRoleScopes: [],
            permissionCount: allScopes.length,
            highRiskPermissions: highRiskPermissions,
            mediumRiskPermissions: mediumRiskPermissions,
            lastTimeUsed: grant.startTime || grant.createdTime || new Date().toISOString(),
            assignedDate: grant.startTime || grant.createdTime || new Date().toISOString(),
            assignmentType: 'DelegatedPermission',
            lastSignInDateTime: user.lastSignInDateTime || undefined
          });
        }
      }

      console.log(`🎉 Successfully processed ${tokens.length} application tokens across ${processedUserCount} users`);
      
      // Log a sample token for debugging
      if (tokens.length > 0) {
        console.log('📝 Sample token structure:');
        console.log(JSON.stringify({
          clientId: tokens[0].clientId,
          displayText: tokens[0].displayText,
          userEmail: tokens[0].userEmail,
          scopes: tokens[0].scopes,
          userScopes: tokens[0].userScopes, 
          assignmentType: tokens[0].assignmentType
        }, null, 2));
      }
      
      return tokens;

    } catch (error) {
      console.error('❌ Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  // Helper function to create user-application relationship with scopes
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