import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// **NEW: Rate limiting configuration to prevent quota violations**
interface RateLimitConfig {
  requestsPerMinute: number;
  burstLimit: number;
  adaptiveDelay: boolean;
  maxRetries: number;
  backoffMultiplier: number;
}

class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private requestTimes: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async makeRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await this.executeWithRetry(requestFn);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      
      // Wait for rate limit if needed
      await this.waitForRateLimit();
      
      // Execute the request
      await request();
      
      // Record the request time
      const now = Date.now();
      this.requestTimes.push(now);
      
      // Clean old request times (older than 1 minute)
      this.requestTimes = this.requestTimes.filter(time => now - time < 60000);
    }

    this.processing = false;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const recentRequests = this.requestTimes.filter(time => now - time < 60000);
    
    if (recentRequests.length >= this.config.requestsPerMinute) {
      // Calculate delay needed
      const oldestRequest = Math.min(...recentRequests);
      const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${Math.round(waitTime/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Adaptive delay based on recent request frequency
    if (this.config.adaptiveDelay && recentRequests.length > this.config.requestsPerMinute * 0.8) {
      const adaptiveDelay = Math.min(1000, recentRequests.length * 10);
      await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
    }
  }

  private async executeWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a quota error
        if (this.isQuotaError(error)) {
          const delay = Math.pow(this.config.backoffMultiplier, attempt) * 1000;
          console.log(`🚫 Quota error (attempt ${attempt + 1}/${this.config.maxRetries}), waiting ${delay/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // For non-quota errors, don't retry
        throw error;
      }
    }
    
    throw lastError;
  }

  private isQuotaError(error: any): boolean {
    return error?.code === 429 || 
           error?.status === 429 ||
           error?.message?.includes('quota') ||
           error?.message?.includes('rate limit') ||
           error?.message?.includes('Quota exceeded');
  }
}

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
  private rateLimiter: RateLimiter;

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

    // **NEW: Initialize rate limiter with conservative settings**
    // Google Admin SDK has a default limit of 2,400 queries per minute per user
    // We set it to 1,800 to leave headroom and prevent quota violations
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 1800, // 75% of Google's 2,400 limit
      burstLimit: 100,         // Allow small bursts
      adaptiveDelay: true,     // Enable adaptive delays
      maxRetries: 3,           // Retry quota errors 3 times
      backoffMultiplier: 2     // Exponential backoff (2s, 4s, 8s)
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

          // // DEBUGGING: Check the scopes of the new token
          // console.log('🔍 Checking scopes of the newly refreshed token...');
          // const tokenInfo = await this.getTokenInfo(updatedCredentials.access_token);
          // if (tokenInfo) {
          //   console.log('✅ Token info retrieved:', {
          //     scopes: tokenInfo.scope,
          //     expires_in: tokenInfo.expires_in,
          //     user_id: tokenInfo.user_id,
          //     email: tokenInfo.email
          //   });
          // } else {
          //   console.error('❌ Could not retrieve token info.');
          // }
          // // END DEBUGGING
          
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
    // **NEW: Use rate limiter for API calls**
    return await this.rateLimiter.makeRequest(async () => {
      const response = await this.admin.users.list({
        customer: 'my_customer',
        maxResults: 500,
        orderBy: 'email',
      });
      return response.data.users;
    });
  }

  async getUserDetails(userKey: string) {
    // **NEW: Use rate limiter for API calls**
    return await this.rateLimiter.makeRequest(async () => {
      const response = await this.admin.users.get({
        userKey,
      });
      return response.data;
    });
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      // Get all users in the organization
      const users = await this.getUsersListPaginated();
      console.log(`Found ${users.length} users in the organization`);
      
      // **NEW: Conservative batch sizes to respect quota limits**
      const batchSize = 25;   // Reduced from 100 to prevent quota violations
      const maxConcurrentBatches = 5; // Significantly reduced from 100
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
          // **NEW: Increased stagger delay to prevent quota violations**
          await new Promise(resolve => setTimeout(resolve, batchIndex * 500)); // Increased from 100ms to 500ms
          
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
        
        // **NEW: Longer pause between major batch groups to respect rate limits**
        if (i + maxConcurrentBatches < userBatches.length) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Increased from 500ms to 2s
          console.log(`⏳ Pausing 2s between batch groups to respect API quotas...`);
        }
      }
      
      return allTokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  // **NEW: Rate-limited helper method to fetch user tokens with efficient pagination**
  private async fetchUserTokens(user: any): Promise<any[]> {
    let pageToken: string | undefined = undefined;
    let allTokens: any[] = [];
    
    do {
      try {
        // **NEW: Use rate limiter for every API call**
        const listResponse: { data: { items?: any[]; nextPageToken?: string } } = await this.rateLimiter.makeRequest(async () => {
          return await this.admin.tokens.list({
            userKey: user.primaryEmail,
            maxResults: 100,
            pageToken
          });
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
        // **NEW: Process tokens sequentially with rate limiting instead of parallel**
        const batchResults = [];
        for (const token of batch) {
          try {
            // **NEW: Use rate limiter for each token detail request**
            const detailResponse = await this.rateLimiter.makeRequest(async () => {
              return await this.admin.tokens.get({
                userKey: user.primaryEmail,
                clientId: token.clientId
              });
            });
            
            const detailedToken = detailResponse.data;
            const scopes = new Set<string>();
            
            // More efficient scope processing
            this.processTokenScopes(detailedToken, scopes);
            
            batchResults.push({
              ...detailedToken,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: Array.from(scopes)
            });
          } catch (error) {
            // Return basic token info on error
            batchResults.push({
              ...token,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: token.scopes || []
            });
          }
        }
        
        processedTokens.push(...batchResults);
        
        // **NEW: Longer delay between token batches to prevent quota violations**
        if (tokenBatches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 300)); // Increased from 100ms to 300ms
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
        // **NEW: Use rate limiter for admin check**
        const userResponse = await this.rateLimiter.makeRequest(async () => {
          return await this.admin.users.get({
            userKey: email,
            projection: 'full'
          });
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
        // **NEW: Use rate limiter for token access check**
        const tokenResponse = await this.rateLimiter.makeRequest(async () => {
          return await this.admin.tokens.list({
            userKey: email,
            maxResults: 1
          });
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
      // console.log('Using credentials with scopes:', this.oauth2Client.credentials.scope);
      
      do {
        console.log(`Fetching user page${pageToken ? ' with token: ' + pageToken : ''}`);
        
        // **NEW: Use rate limiter for paginated user list calls**
        const response: any = await this.rateLimiter.makeRequest(async () => {
          return await this.admin.users.list({
            customer: 'my_customer',
            maxResults: 500,
            orderBy: 'email',
            pageToken,
            viewType: 'admin_view',
            projection: 'full'
          });
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
        
        // console.log('User page response:', {
        //   hasUsers: !!response.data.users,
        //   userCount: response.data.users?.length || 0,
        //   hasNextPage: !!response.data.nextPageToken
        // });
        
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

  // async getTokenInfo(accessToken: string) {
  //   try {
  //     const tokenInfo = await this.oauth2.tokeninfo({
  //       access_token: accessToken,
  //     });
  //     return tokenInfo.data;
  //   } catch (error: any) {
  //     console.error('Error fetching token info:', error.response?.data || error.message);
  //     return null;
  //   }
  // }
} 