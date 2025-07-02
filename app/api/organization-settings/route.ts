import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create Supabase admin client
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

interface OrganizationSettings {
  id?: string;
  organization_id: string;
  bucket_weights: {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
  };
  ai_multipliers: {
    native: Record<string, number>;
    partial: Record<string, number>;
    none: Record<string, number>;
  };
  scope_multipliers: {
    high: Record<string, number>;
    medium: Record<string, number>;
    low: Record<string, number>;
  };
}

// GET - Retrieve organization settings
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');
    
    if (!orgId) {
      return NextResponse.json({ error: 'Missing org_id parameter' }, { status: 400 });
    }

    const { data: settings, error } = await supabaseAdmin
      .from('organization_settings')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching organization settings:', error);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    // If no settings exist, return default settings
    if (!settings) {
      const defaultSettings: OrganizationSettings = {
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

      return NextResponse.json({ settings: defaultSettings, isDefault: true });
    }

    return NextResponse.json({ settings, isDefault: false });

  } catch (error) {
    console.error('Error in GET organization settings:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST - Create or update organization settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { organization_id, bucket_weights, ai_multipliers, scope_multipliers } = body;

    if (!organization_id) {
      return NextResponse.json({ error: 'Missing organization_id' }, { status: 400 });
    }

    // Validate required fields
    if (!bucket_weights || !ai_multipliers || !scope_multipliers) {
      return NextResponse.json({ 
        error: 'Missing required fields: bucket_weights, ai_multipliers, scope_multipliers' 
      }, { status: 400 });
    }

    // Use upsert to handle both create and update
    const { data: settings, error } = await supabaseAdmin
      .from('organization_settings')
      .upsert({
        organization_id,
        bucket_weights,
        ai_multipliers,
        scope_multipliers
      }, {
        onConflict: 'organization_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting organization settings:', error);
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Organization settings saved successfully',
      settings 
    });

  } catch (error) {
    console.error('Error in POST organization settings:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// DELETE - Delete organization settings (reset to defaults)
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');
    
    if (!orgId) {
      return NextResponse.json({ error: 'Missing org_id parameter' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('organization_settings')
      .delete()
      .eq('organization_id', orgId);

    if (error) {
      console.error('Error deleting organization settings:', error);
      return NextResponse.json({ error: 'Failed to delete settings' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Organization settings deleted successfully' 
    });

  } catch (error) {
    console.error('Error in DELETE organization settings:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 