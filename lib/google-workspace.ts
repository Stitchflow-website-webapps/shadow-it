import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Define interfaces for Google API responses
interface Token {
  clientId: string;
  displayText?: string;
  scopes?: string[];
  userKey: string;
  userEmail?: string;
  lastTimeUsed?: string;
  // Other token fields from Google API
  [key: string]: any;
}

interface Credentials {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  id_token?: string;
  scope?: string;
}

// Authentication options interface for generating OAuth URLs
interface AuthUrlOptions {
  access_type?: 'online' | 'offline';
  include_granted_scopes?: boolean;
  login_hint?: string;
  prompt?: 'none' | 'consent' | 'select_account';
  scope?: string | string[];
  state?: string;
  hd?: string;
}

export class GoogleWorkspaceService {
  private oauth2Client: OAuth2Client;
  private admin: any;
  private oauth2: any;

  constructor(credentials: any) {
    this.oauth2Client = new OAuth2Client({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      redirectUri: credentials.redirect_uri,
    });

    // Initialize admin SDK
    this.admin = google.admin({
      version: 'directory_v1',
      auth: this.oauth2Client
    });

    // Initialize OAuth2 API
    this.oauth2 = google.oauth2({
      version: 'v2',
      auth: this.oauth2Client
    });
  }

  /**
   * Generates an authorization URL for OAuth flow
   * @param options Options for the authorization URL
   * @returns The authorization URL
   */
  generateAuthUrl(options: AuthUrlOptions): string {
    // Default scopes for Google Workspace authentication
    const defaultScopes = [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ];
    
    // Use provided scopes or default scopes
    const scope = options.scope || defaultScopes;
    
    // Generate the URL with the provided options
    return this.oauth2Client.generateAuthUrl({
      // Default to offline access to get refresh token
      access_type: options.access_type || 'offline',
      // Default to including previously granted scopes
      include_granted_scopes: options.include_granted_scopes !== undefined ? options.include_granted_scopes : true,
      // Optional domain restriction
      hd: options.hd,
      // User account hint
      login_hint: options.login_hint,
      // Prompt behavior
      prompt: options.prompt || 'select_account',
      // Scope(s) being requested
      scope,
      // State for CSRF protection
      state: options.state
    });
  }

  async setCredentials(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
  }

  // New method to get current credentials
  getCredentials() {
    return this.oauth2Client.credentials;
  }

  /**
   * Refreshes a token using a refresh token
   * @param refreshToken The refresh token to use
   * @returns Object with the new tokens
   */
  async refreshToken(refreshToken: string) {
    try {
      // Set up the oauth client with just the refresh token
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });
      
      // Request a new access token
      const response = await this.oauth2Client.getAccessToken();
      
      // Handle the response based on its type
      if (response.token && typeof response.token === 'string') {
        // Simple string token
        return {
          access_token: response.token,
          refresh_token: refreshToken, // Keep the original refresh token
          expires_in: 3600, // Default to 1 hour
          expiry_date: Date.now() + 3600 * 1000 // Add expiry_date for consistency
        };
      } else if (response.token && typeof response.token === 'object') {
        // Token is an object
        const tokenObj = response.token as Credentials;
        const expiryDate = tokenObj.expiry_date || (Date.now() + 3600 * 1000);
        return {
          access_token: tokenObj.access_token,
          refresh_token: tokenObj.refresh_token || refreshToken, // Use new refresh token if provided
          id_token: tokenObj.id_token,
          expires_in: Math.floor((expiryDate - Date.now()) / 1000),
          expiry_date: expiryDate
        };
      } else {
        // Fallback to credentials
        const credentials = this.oauth2Client.credentials;
        const expiryDate = credentials.expiry_date || (Date.now() + 3600 * 1000);
        return {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token || refreshToken,
          id_token: credentials.id_token,
          expires_in: Math.floor((expiryDate - Date.now()) / 1000),
          expiry_date: expiryDate
        };
      }
    } catch (error) {
      console.error('Error refreshing Google token:', error);
      throw error;
    }
  }

  /**
   * Refreshes the access token if it's expired or about to expire
   * @param force If true, forces a token refresh regardless of expiry time
   * @returns Object with refreshed tokens or null if refresh wasn't needed
   */
  async refreshAccessToken(force = false) {
    try {
      // Check if we have a refresh token and if the access token is expired or about to expire
      const credentials = this.oauth2Client.credentials;
      
      if (!credentials.refresh_token) {
        console.error('No refresh token available, cannot refresh access token');
        throw new Error('Missing refresh token - unable to refresh access token');
      }
      
      // If expiry_date doesn't exist or is within 5 minutes of expiring, refresh the token
      const now = Date.now();
      const expiryDate = credentials.expiry_date as number;
      const fiveMinutesInMs = 5 * 60 * 1000;
      
      if (force || !expiryDate || now >= expiryDate - fiveMinutesInMs) {
        if (force) {
          console.log('Forcing token refresh as requested');
        } else {
          console.log('Access token expired or about to expire, refreshing...');
        }
        
        // Request a new access token
        try {
          const response = await this.oauth2Client.getAccessToken();
          
          // Get the updated credentials after refresh
          const updatedCredentials = this.oauth2Client.credentials;
          
          // Ensure we have a valid access token
          if (!updatedCredentials.access_token) {
            throw new Error('No access token received after refresh');
          }
          
          // Create a clean credentials object
          const newCredentials = {
            access_token: updatedCredentials.access_token,
            refresh_token: updatedCredentials.refresh_token || credentials.refresh_token,
            expiry_date: updatedCredentials.expiry_date || (Date.now() + 3600 * 1000),
            id_token: updatedCredentials.id_token,
            scope: updatedCredentials.scope || credentials.scope
          };
          
          // Explicitly set the new credentials to ensure they're used
          this.oauth2Client.setCredentials(newCredentials);
          
          // Reinitialize the admin SDK with the refreshed credentials
          this.admin = google.admin({
            version: 'directory_v1',
            auth: this.oauth2Client
          });
          
          // Reinitialize the OAuth2 API with the refreshed credentials
          this.oauth2 = google.oauth2({
            version: 'v2',
            auth: this.oauth2Client
          });
          
          console.log('Successfully refreshed access token and updated all services');
          return newCredentials;
        } catch (refreshError) {
          console.error('Failed to refresh access token:', refreshError);
          
          // Add more context to the error
          if (refreshError instanceof Error) {
            // Check for common OAuth errors and provide better messages
            if (refreshError.message.includes('invalid_grant')) {
              throw new Error(`Invalid refresh token. OAuth grant has expired or been revoked: ${refreshError.message}`);
            } else {
              throw new Error(`Token refresh failed: ${refreshError.message}`);
            }
          }
          
          throw refreshError; // Re-throw any other errors
        }
      }
      
      if (!force) {
        console.log('Access token still valid, no refresh needed');
        return null;
      } else {
        // If force=true but the token isn't expired, still return the current tokens
        console.log('Force refresh requested but token still valid - returning current credentials');
        return {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expiry_date: credentials.expiry_date
        };
      }
    } catch (error) {
      console.error('Error in refreshAccessToken:', error);
      throw error;
    }
  }

  async getUsersList() {
    // https: // developers.google.com/admin-sdk/directory/reference/rest/v1/users/list
    const response = await this.admin.users.list({
      customer: 'my_customer',
      maxResults: 500,
      orderBy: 'email',
    });
    return response.data.users;
  }

  async getUserDetails(userKey: string) {
    const response = await this.admin.users.get({
      userKey,
    });
    return response.data;
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      // Get all users in the organization
      const users = await this.getUsersListPaginated();
      console.log(`Found ${users.length} users in the organization`);
      
      // Increased batch size and concurrent processing
      const batchSize = 100; // Increased from 5
      const maxConcurrentBatches = 100;
      const userBatches: any[][] = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }
      
      let allTokens: Token[] = [];
      
      // Process batches with controlled concurrency
      for (let i = 0; i < userBatches.length; i += maxConcurrentBatches) {
        const currentBatches = userBatches.slice(i, i + maxConcurrentBatches);
        console.log(`Processing batches ${i + 1} to ${i + currentBatches.length} of ${userBatches.length}`);
        
        const batchPromises = currentBatches.map(async (userBatch, batchIndex) => {
          // Stagger the start of concurrent batches to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, batchIndex * 100));
          
          return Promise.all(userBatch.map(async (user: any) => {
            try {
              console.log(`Fetching tokens for user: ${user.primaryEmail}`);
              
              // Get tokens list with pagination - now in parallel
              const userTokens = await this.fetchUserTokens(user);
              
              // Process tokens in larger batches with parallel processing
              const processedTokens = await this.processUserTokens(user, userTokens);
              
              console.log(`Found ${processedTokens.length} tokens for user ${user.primaryEmail}`);
              return processedTokens;
            } catch (error: any) {
              console.error(`Error processing user ${user.primaryEmail}:`, error.message);
              return []; // Return empty array on error to continue with other users
            }
          }));
        });
        
        const batchResults = await Promise.all(batchPromises);
        allTokens = [...allTokens, ...batchResults.flat(2)];
        
        // Brief pause between major batch groups to respect rate limits
        if (i + maxConcurrentBatches < userBatches.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
          // This 500ms pause between major batch groups helps prevent
          // overwhelming the API with too many requests in a short time
        }
      }
      
      return allTokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  // New helper method to fetch user tokens with efficient pagination
  private async fetchUserTokens(user: any): Promise<any[]> {
    let pageToken: string | undefined = undefined;
    let allTokens: any[] = [];
    
    do {
      try {
        const listResponse: { data: { items?: any[]; nextPageToken?: string } } = await this.admin.tokens.list({
          userKey: user.primaryEmail,
          maxResults: 100,
          pageToken
        });
        
        if (listResponse.data.items) {
          allTokens = [...allTokens, ...listResponse.data.items];
        }
        
        pageToken = listResponse.data.nextPageToken;
      } catch (error: any) {
        if (error.code === 404) {
          console.log(`No tokens found for user: ${user.primaryEmail}`);
          return [];
        }
        throw error;
      }
    } while (pageToken);
    
    return allTokens;
  }

  // New helper method to process user tokens efficiently
  private async processUserTokens(user: any, tokens: any[]): Promise<Token[]> {
    if (!tokens.length) return [];
    
    const batchSize = 100; // Process 5 tokens at once
    const tokenBatches = [];
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      tokenBatches.push(tokens.slice(i, i + batchSize));
    }
    
    const processedTokens: Token[] = [];
    
    for (const batch of tokenBatches) {
      try {
        const batchResults = await Promise.all(batch.map(async (token) => {
          try {
            const detailResponse = await this.admin.tokens.get({
              userKey: user.primaryEmail,
              clientId: token.clientId
            });
            
            const detailedToken = detailResponse.data;
            const scopes = new Set<string>();
            
            // More efficient scope processing
            this.processTokenScopes(detailedToken, scopes);
            
            return {
              ...detailedToken,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: Array.from(scopes)
            };
          } catch (error) {
            // Return basic token info on error
            return {
              ...token,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: token.scopes || []
            };
          }
        }));
        
        processedTokens.push(...batchResults);
        
        // Minimal delay between batches
        if (tokenBatches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error processing token batch for ${user.primaryEmail}:`, error);
      }
    }
    
    return processedTokens;
  }

  // New helper method for efficient scope processing
  private processTokenScopes(token: any, scopes: Set<string>): void {
    // Process direct scopes
    if (Array.isArray(token.scopes)) {
      token.scopes.forEach((s: string) => scopes.add(s));
    }
    
    // Process scope data
    if (Array.isArray(token.scopeData)) {
      token.scopeData.forEach((sd: any) => {
        if (sd.scope) scopes.add(sd.scope);
        if (sd.value) scopes.add(sd.value);
      });
    }
    
    // Process string scope
    if (typeof token.scope === 'string') {
      token.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
    }
    
    // Process admin scopes
    if (token.displayText?.match(/Admin|Google|Workspace/i) && 
        [...scopes].some(s => s.includes('admin.directory'))) {
      this.addAdminScopes(scopes);
    }
  }

  // Helper for admin scopes
  private addAdminScopes(scopes: Set<string>): void {
    const adminScopes = [
      'https://www.googleapis.com/auth/admin.directory.device.chromeos',
      'https://www.googleapis.com/auth/admin.directory.device.mobile',
      'https://www.googleapis.com/auth/admin.directory.group',
      'https://www.googleapis.com/auth/admin.directory.group.member',
      'https://www.googleapis.com/auth/admin.directory.orgunit',
      'https://www.googleapis.com/auth/admin.directory.resource.calendar',
      'https://www.googleapis.com/auth/admin.directory.rolemanagement',
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/admin.directory.user.alias',
      'https://www.googleapis.com/auth/admin.directory.user.security'
    ];
    adminScopes.forEach(s => scopes.add(s));
  }

  async getToken(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  // Add method to get authenticated user info
  async getAuthenticatedUserInfo() {
    const response = await this.oauth2.userinfo.get();
    return response.data;
  }

  // Check if a user is an admin with the required permissions for Shadow IT scanning
  async isUserAdmin(email: string): Promise<boolean> {
    try {
      console.log(`Checking admin permissions for Shadow IT scanning: ${email}`);
      
      // Method 1: Direct admin check using user.get() and isAdmin field
      // This is the most reliable way to check admin status
      try {
        const userResponse = await this.admin.users.get({
          userKey: email,
          projection: 'full'
        });
        
        const userData = userResponse.data;
        
        // Check the isAdmin field directly
        if (userData.isAdmin === true) {
          console.log(`User is confirmed admin (isAdmin=true) for: ${email}`);
          return true;
        }
        
        // Check if user is a delegated admin
        if (userData.isDelegatedAdmin === true) {
          console.log(`User is confirmed delegated admin (isDelegatedAdmin=true) for: ${email}`);
          return true;
        }
        
        // If neither admin flag is true, they're not an admin
        if (userData.isAdmin === false && userData.isDelegatedAdmin === false) {
          console.log(`User is confirmed non-admin (both flags false) for: ${email}`);
          return false;
        }
        
        console.log(`Admin status unclear from user data for: ${email}, trying fallback methods`);
      } catch (userGetError: any) {
        console.log(`User.get check failed: ${userGetError.message}`);
      }

      // Method 2: Try to access user security tokens (specific to our Shadow IT needs)
      try {
        const tokenResponse = await this.admin.tokens.list({
          userKey: email,
          maxResults: 1
        });
        
        console.log(`Successfully accessed tokens API, admin confirmed for: ${email}`);
        return true;
      } catch (tokenError: any) {
        console.log(`Token access check failed: ${tokenError.message}`);
        
        // Try accessing another user's tokens (requires broader admin permissions)
        try {
          const usersResponse = await this.admin.users.list({
            customer: 'my_customer',
            maxResults: 2
          });
          
          if (usersResponse.data.users && usersResponse.data.users.length > 0) {
            const testUser = usersResponse.data.users.find((u: any) => u.primaryEmail !== email) 
              || usersResponse.data.users[0];
            
            await this.admin.tokens.list({
              userKey: testUser.primaryEmail,
              maxResults: 1
            });
            
            console.log(`Successfully accessed other user's tokens, admin confirmed for: ${email}`);
            return true;
          }
        } catch (otherTokenError: any) {
          console.log(`Other user token check failed: ${otherTokenError.message}`);
        }
      }

      // Method 3: Try to list users (basic admin check)
      try {
        const listResponse = await this.admin.users.list({
          customer: 'my_customer',
          maxResults: 1,
          projection: 'basic'
        });
        
        console.log(`Successfully listed users, admin confirmed for: ${email}`);
        return true;
      } catch (listError: any) {
        console.log(`Users list check failed: ${listError.message}`);
      }

      // Method 4: Try domain operations (for Super Admins)
      try {
        const domainResponse = await this.admin.domains.list({
          customer: 'my_customer'
        });
        
        console.log(`Successfully listed domains, super admin confirmed for: ${email}`);
        return true;
      } catch (domainError: any) {
        console.log(`Domain list check failed: ${domainError.message}`);
      }

      // If all methods fail, the user doesn't have admin permissions
      console.log(`All admin permission checks failed for: ${email}`);
      return false;

    } catch (error: any) {
      console.error(`Error in isUserAdmin for ${email}:`, error.message);
      return false;
    }
  }

  // Add this optimized method to get user list with pagination support
  async getUsersListPaginated(): Promise<any[]> {
    let users: any[] = [];
    let pageToken: string | undefined = undefined;
    
    try {
      console.log('Starting paginated user list fetch');
      console.log('Using credentials with scopes:', this.oauth2Client.credentials.scope);
      
      do {
        console.log(`Fetching user page${pageToken ? ' with token: ' + pageToken : ''}`);
        
        const response: any = await this.admin.users.list({
          customer: 'my_customer',
          maxResults: 500,
          orderBy: 'email',
          pageToken,
          viewType: 'admin_view',
          projection: 'full'
        }).catch((error: any) => {
          console.error('Error in users.list API call:', {
            code: error?.code,
            message: error?.message,
            status: error?.status,
            response: error?.response?.data,
            scopes: this.oauth2Client.credentials.scope,
            credentials: {
              hasAccess: !!this.oauth2Client.credentials.access_token,
              hasRefresh: !!this.oauth2Client.credentials.refresh_token,
              expiry: this.oauth2Client.credentials.expiry_date 
                ? new Date(this.oauth2Client.credentials.expiry_date).toISOString() 
                : 'unknown'
            }
          });
          throw error;
        });
        
        console.log('User page response:', {
          hasUsers: !!response.data.users,
          userCount: response.data.users?.length || 0,
          hasNextPage: !!response.data.nextPageToken
        });
        
        if (response.data.users && response.data.users.length > 0) {
          users = [...users, ...response.data.users];
        }
        
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      
      console.log(`Successfully fetched ${users.length} total users`);
      return users;
    } catch (error: any) {
      console.error('Error in getUsersListPaginated:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        status: error?.status,
        response: error?.response?.data,
        scopes: this.oauth2Client.credentials.scope,
        requestedScopes: this.oauth2Client.credentials.scope?.split(' ') || []
      });
      throw error;
    }
  }
} 