import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organizationId } = body;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

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

    // Verify the organization exists
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain')
      .eq('id', organizationId)
      .single();

    if (orgError || !organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Create response with success
    const response = NextResponse.json({ 
      success: true, 
      organization: organization,
      redirectUrl: 'https://stitchflow.com/'
    });

    // Set cookies for the selected organization
    const cookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.stitchflow.com' : undefined,
      maxAge: 60 * 60 * 24 * 30 // 30 days
    };

    response.cookies.set('orgId', organizationId, cookieOptions);
    response.cookies.set('userOrgId', organizationId, cookieOptions);
    response.cookies.set('userHd', organization.domain, cookieOptions);

    console.log(`Organization selected: ${organization.name} (${organizationId}) by ${session.user_email}`);

    return response;

  } catch (error) {
    console.error('Error in org selection API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 