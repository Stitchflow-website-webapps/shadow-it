import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
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

    // Fetch all organizations with basic info
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select(`
        id,
        name,
        domain,
        auth_provider,
        created_at,
        updated_at
      `)
      .order('name');

    if (orgError) {
      console.error('Error fetching organizations:', orgError);
      return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
    }

    // Get application counts for each organization
    const organizationsWithCounts = await Promise.all(
      (organizations || []).map(async (org) => {
        const { count } = await supabaseAdmin
          .from('applications')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', org.id);

        return {
          ...org,
          applicationCount: count || 0
        };
      })
    );

    return NextResponse.json({ 
      organizations: organizationsWithCounts 
    });

  } catch (error) {
    console.error('Error in organizations API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 