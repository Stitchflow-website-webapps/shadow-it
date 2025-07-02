import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'shadow_it'
    }
  }
);

// Endpoint to create default notification preferences when a user signs up
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orgId, userEmail } = body;
    
    // Validate required parameters
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    
    if (!userEmail) {
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }
    
    // Check if preferences already exist for this user and organization
    const { data: existingPrefs, error: checkError } = await supabaseAdmin
      .from('notification_preferences')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_email', userEmail)
      .single();
    
    // If preferences already exist, no need to create them again
    if (existingPrefs) {
      return NextResponse.json({ 
        success: true, 
        message: 'Notification preferences already exist', 
        id: existingPrefs.id 
      });
    }
    
    // Only create preferences if they don't exist yet
    const defaultPreferences = {
      new_app_detected: true,
      new_user_in_app: true,
      new_user_in_review_app: true
    };
    
    // Create default notification preferences
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .insert({
        organization_id: orgId,
        user_email: userEmail,
        new_app_detected: defaultPreferences.new_app_detected,
        new_user_in_app: defaultPreferences.new_user_in_app,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating default notification preferences:', error);
      return NextResponse.json({ error: 'Failed to create default notification preferences' }, { status: 500 });
    }
    
    // Also create default organization settings if they don't exist
    const { data: existingOrgSettings, error: orgCheckError } = await supabaseAdmin
      .from('organization_settings')
      .select('id')
      .eq('organization_id', orgId)
      .single();
    
    let orgSettingsData = null;
    
    // Only create organization settings if they don't exist yet
    if (!existingOrgSettings) {
      const defaultOrgSettings = {
        organization_id: orgId,
        bucket_weights: {
          dataPrivacy: 20,
          securityAccess: 25,
          businessImpact: 20,
          aiGovernance: 20,
          vendorProfile: 15
        },
        ai_multipliers: {
          native: {
            dataPrivacy: 1.5,
            securityAccess: 1.4,
            businessImpact: 1.3,
            aiGovernance: 1.6,
            vendorProfile: 1.2
          },
          partial: {
            dataPrivacy: 1.2,
            securityAccess: 1.1,
            businessImpact: 1.1,
            aiGovernance: 1.3,
            vendorProfile: 1.0
          },
          none: {
            dataPrivacy: 1.0,
            securityAccess: 1.0,
            businessImpact: 1.0,
            aiGovernance: 1.0,
            vendorProfile: 1.0
          }
        },
        scope_multipliers: {
          high: {
            dataPrivacy: 1.4,
            securityAccess: 1.5,
            businessImpact: 1.3,
            aiGovernance: 1.2,
            vendorProfile: 1.1
          },
          medium: {
            dataPrivacy: 1.2,
            securityAccess: 1.2,
            businessImpact: 1.1,
            aiGovernance: 1.1,
            vendorProfile: 1.0
          },
          low: {
            dataPrivacy: 1.0,
            securityAccess: 1.0,
            businessImpact: 1.0,
            aiGovernance: 1.0,
            vendorProfile: 1.0
          }
        }
      };
      
      const { data: orgSettings, error: orgSettingsError } = await supabaseAdmin
        .from('organization_settings')
        .insert(defaultOrgSettings)
        .select()
        .single();
      
      if (orgSettingsError) {
        console.error('Error creating default organization settings:', orgSettingsError);
        // Don't fail the request if org settings creation fails, just log it
        console.log('Continuing without organization settings...');
      } else {
        orgSettingsData = orgSettings;
        console.log('Default organization settings created successfully');
      }
    } else {
      console.log('Organization settings already exist');
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Default preferences and settings created successfully', 
      preferences: data,
      organizationSettings: orgSettingsData || existingOrgSettings
    });
  } catch (error) {
    console.error('Error in create-default-preferences:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 