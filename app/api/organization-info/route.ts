import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Basic session validation - check if user is authenticated
    const sessionId = request.headers.get('cookie')
      ?.split(';')
      .find(c => c.trim().startsWith('shadow_session_id='))
      ?.split('=')[1];

    if (!sessionId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify session exists and is valid
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('user_sessions')
      .select('user_email')
      .eq('id', sessionId)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Only allow access for the special email
    if (session.user_email !== 'success@stitchflow.io') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Fetch organization details
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, auth_provider')
      .eq('id', orgId)
      .single();

    if (orgError || !organization) {
      console.error('Error fetching organization:', orgError);
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      organization: {
        id: organization.id,
        name: organization.name,
        domain: organization.domain,
        authProvider: organization.auth_provider
      }
    });

  } catch (error) {
    console.error('Error in organization-info API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
