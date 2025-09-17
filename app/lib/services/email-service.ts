import { LoopsClient, APIError, RateLimitExceededError } from "loops";

const loops = new LoopsClient(process.env.LOOPS_API_KEY!);

export interface AppNotificationData {
  to: string;
  userName?: string;
  appName: string;
  organizationName?: string;
  detectionTime?: string;
  riskLevel?: string;
  category?: string;
  userCount?: number;
  totalPermissions?: number;
  notificationType: 'new_app' | 'new_user' | 'new_user_review';
  subjectPrefix?: string;
}

export class EmailService {
  // Template IDs from your Loops.so dashboard
  private static readonly NEW_APP_TEMPLATE_ID = process.env.NEW_APP_TEMPLATE_ID!;
  private static readonly NEW_USER_TEMPLATE_ID = process.env.NEW_USER_TEMPLATE_ID!;
  private static readonly NEW_USER_REVIEW_TEMPLATE_ID = process.env.NEW_USER_REVIEW_TEMPLATE_ID!;

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private static getSubjectForNotificationType(data: AppNotificationData): string {
    const prefix = data.subjectPrefix || 'Shadow IT Alert';
    
    switch (data.notificationType) {
      case 'new_app':
        return `${prefix}: New App Detected - ${data.appName}`;
      case 'new_user':
        return `${prefix}: New User Added to ${data.appName}`;
      case 'new_user_review':
        return `${prefix}: New User Added to Review-flagged App ${data.appName}`;
      default:
        return `${prefix}: Shadow IT Notification`;
    }
  }

  private static getTemplateIdForType(notificationType: string): string {
    switch (notificationType) {
      case 'new_app':
        return this.NEW_APP_TEMPLATE_ID;
      case 'new_user':
        return this.NEW_USER_TEMPLATE_ID;
      case 'new_user_review':
        return this.NEW_USER_REVIEW_TEMPLATE_ID;
      default:
        return this.NEW_APP_TEMPLATE_ID; // Default to new app template
    }
  }

  private static async sendNotificationEmail(data: AppNotificationData) {
    if (!this.isValidEmail(data.to)) {
      console.error('Invalid email address:', data.to);
      throw new Error('Invalid email address');
    }

    try {
      // Get the appropriate template ID
      const templateId = this.getTemplateIdForType(data.notificationType);
      
      // Generate subject if not provided
      const subject = this.getSubjectForNotificationType(data);

      console.log(`Sending ${data.notificationType} notification to ${data.to} for app ${data.appName}`);

      // Common variables for all notification types
      const commonVariables = {
        app_name: data.appName,
        organization_name: data.organizationName || '',
        risk_level: data.riskLevel || 'Unknown',
        category: data.category || 'Uncategorized',
        total_permissions: data.totalPermissions || 0,
        subject_name: subject
      };

      // Template-specific variables
      let templateVariables: Record<string, any> = {};
      
      switch (data.notificationType) {
        case 'new_app':
          templateVariables = {
            ...commonVariables,
            number_permissions: data.totalPermissions || 0,
            total_users: data.userCount || 0,
            user_count: data.userCount || 0,
            detection_time: data.detectionTime || new Date().toISOString()
          };
          break;
        
        case 'new_user':
        case 'new_user_review':
          templateVariables = {
            ...commonVariables,
            user_name: data.userName || '',
            user_email: data.userName || '', // Using userName as email if needed
            user_number_permissions: data.totalPermissions || 0,
            app_status: data.notificationType === 'new_user_review' ? 'Needs Review' : ''
          };
          break;
      }

      // Send the email
      await loops.sendTransactionalEmail({
        transactionalId: templateId,
        email: data.to,
        addToAudience: true,
        dataVariables: templateVariables
      });

      console.log(`Successfully sent ${data.notificationType} notification email to ${data.to}`);
      return true;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        console.error(`Rate limit exceeded (${error.limit} per second)`);
        throw error;
      } else if (error instanceof APIError) {
        console.error('API Error:', JSON.stringify(error.json));
        console.error('Status code:', error.statusCode);
        throw error;
      } else {
        console.error('Failed to send email:', error);
        throw error;
      }
    }
  }

  static async sendNewAppNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_app'
    });
  }

  static async sendNewUserNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_user'
    });
  }

  static async sendNewUserReviewNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_user_review'
    });
  }

  // Utility method to test if API key is valid
  static async testApiKey() {
    try {
      const response = await loops.testApiKey();
      return true; // If no error is thrown, the key is valid
    } catch (error) {
      if (error instanceof APIError) {
        console.error('Invalid API key');
        return false;
      }
      throw error;
    }
  }

  static async sendNewAppsDigest(to: string, eventAppsString: string, organizationName: string, creationSource?: boolean) {
    if (!this.NEW_APP_TEMPLATE_ID) {
      console.error('NEW_APP_TEMPLATE_ID is not set');
      return false;
    }
    
    // Determine the platform and send appropriate variables
    const isAppHub = creationSource === false;
    
    try {
      await loops.sendTransactionalEmail({
        transactionalId: this.NEW_APP_TEMPLATE_ID,
        email: to,
        dataVariables: {
          'event-apps': eventAppsString,
          'platform_type': isAppHub ? 'AppHub' : 'Shadow IT',
          'platform_link': isAppHub ? 'AppHub' : 'Shadow IT dashboard',
          'greeting': isAppHub ? 'Hello,' : 'Hi there,',
          'intro_text': isAppHub 
            ? 'We\'ve discovered additional app(s) for you to review. Visit AppHub for more details.' 
            : 'Heads up—our latest scan detected new app(s) being used in your workspace. For deeper insights, go to your Shadow IT dashboard.',
          'details_header': 'Here are the details:',
          'closing': isAppHub ? '\nBest,\nAppHub' : '\nBest,\nStitchflow Shadow IT Scanner'
        }
      });
      console.log(`Successfully sent new apps digest to ${to} (${isAppHub ? 'AppHub' : 'Shadow IT'} format)`);
      return true;
    } catch (error) {
      console.error(`Failed to send new apps digest to ${to}:`, error);
      return false;
    }
  }

  static async sendNewUsersDigest(to: string, eventUsersString: string, organizationName: string, creationSource?: boolean) {
    if (!this.NEW_USER_TEMPLATE_ID) {
      console.error('NEW_USER_TEMPLATE_ID is not set');
      return false;
    }
    
    // Determine the platform and send appropriate variables
    const isAppHub = creationSource === false;
    
    try {
      await loops.sendTransactionalEmail({
        transactionalId: this.NEW_USER_TEMPLATE_ID,
        email: to,
        dataVariables: {
          'event-users': eventUsersString,
          'platform_type': isAppHub ? 'AppHub' : 'Shadow IT',
          'platform_link': isAppHub ? 'AppHub' : 'Shadow IT dashboard',
          'greeting': isAppHub ? 'Hello,' : 'Hi there,',
          'intro_text': isAppHub 
            ? 'We\'ve discovered additional user(s) for you to review. Visit AppHub for more details.' 
            : 'Looks like there\'s some new user(s) in your org workspace. For deeper insights, go to your Shadow IT dashboard.',
          'details_header': 'Here are the details:',
          'closing': isAppHub ? '\nBest,\nAppHub' : '\nBest,\nStitchflow Shadow IT Scanner'
        }
      });
      console.log(`Successfully sent new users digest to ${to} (${isAppHub ? 'AppHub' : 'Shadow IT'} format)`);
      return true;
    } catch (error) {
      console.error(`Failed to send new users digest to ${to}:`, error);
      return false;
    }
  }

  static async sendReAuthenticationRequired(to: string, organizationName: string, provider: 'google' | 'microsoft') {
    const transactionalId = process.env.LOOPS_TRANSACTIONAL_ID_REAUTH_REQUIRED;
    if (!transactionalId) {
      console.error('LOOPS_TRANSACTIONAL_ID_REAUTH_REQUIRED is not set');
      return false;
    }
    
    // Generate the actual OAuth URL based on provider
    let reAuthUrl: string;
    
    if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirectUri = process.env.NODE_ENV === 'production' 
        ? 'https://stitchflow.com/tools/shadow-it-scan/api/auth/google'
        : `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/google`;
      
      const scopes = [
        'openid',
        'profile', 
        'email',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.security'
      ].join(' ');
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', clientId!);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('include_granted_scopes', 'true');
      authUrl.searchParams.append('prompt', 'consent');
      authUrl.searchParams.append('reauth', 'true');
      authUrl.searchParams.append('org', encodeURIComponent(organizationName));
      
      reAuthUrl = authUrl.toString();
    } else {
      // Microsoft
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const redirectUri = process.env.NODE_ENV === 'production'
        ? 'https://www.stitchflow.com/tools/shadow-it-scan/api/auth/microsoft'
        : `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/microsoft`;
      
      const scopes = [
        'User.Read',
        'offline_access',
        'openid',
        'profile',
        'email',
        'Directory.Read.All',
        'Application.Read.All',
        'DelegatedPermissionGrant.ReadWrite.All',
        'AppRoleAssignment.ReadWrite.All'
      ].join(' ');
      
      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.append('client_id', clientId!);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('response_mode', 'query');
      authUrl.searchParams.append('prompt', 'consent');
      authUrl.searchParams.append('reauth', 'true');
      authUrl.searchParams.append('org', encodeURIComponent(organizationName));
      
      reAuthUrl = authUrl.toString();
    }
    
    try {
      await loops.sendTransactionalEmail({
        transactionalId,
        email: to,
        dataVariables: {
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          reauth_url: reAuthUrl
        }
      });
      console.log(`Successfully sent re-authentication email to ${to} for ${provider}`);
      return true;
    } catch (error) {
      console.error(`Failed to send re-authentication email to ${to}:`, error);
      return false;
    }
  }
} 