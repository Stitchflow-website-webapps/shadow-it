import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  // 1. Authenticate the request using a secret bearer token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];

  if (token !== process.env.CRON_SECRET) {
    console.error('[CronTrigger] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🚀 [CronTrigger] Starting cron trigger job...');

  try {
    // 2. Fetch all organizations
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('domain, auth_provider');

    if (orgError) {
      console.error('[CronTrigger] Error fetching organizations:', orgError);
      return NextResponse.json({ error: 'Error fetching organizations' }, { status: 500 });
    }

    if (!organizations || organizations.length === 0) {
      console.log('[CronTrigger] No organizations found to process.');
      return NextResponse.json({ message: 'No organizations to process' });
    }
    
    console.log(`[CronTrigger] Found ${organizations.length} organizations to process.`);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://www.managed.stitchflow.com";

    // 3. Trigger the specific cron for each organization
    for (const org of organizations) {
      if (!org.domain || !org.auth_provider) {
        console.warn(`[CronTrigger] Skipping organization with missing domain or provider.`, org);
        continue;
      }

      let cronUrl = '';
      if (org.auth_provider === 'google') {
        cronUrl = `${baseUrl}/api/background/test-cron-google?orgDomain=${org.domain}`;
      } else if (org.auth_provider === 'microsoft') {
        cronUrl = `${baseUrl}/api/background/test-cron-microsoft?orgDomain=${org.domain}`;
      } else {
        console.log(`[CronTrigger] Skipping organization ${org.domain} with unsupported provider: ${org.auth_provider}`);
        continue;
      }

      console.log(`[CronTrigger] Triggering cron for ${org.domain}`);
      
      // Fire-and-forget the fetch request
      fetch(cronUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
      }).catch(fetchError => {
        // Log errors but don't stop the loop
        console.error(`[CronTrigger] Fetch error triggering cron for org ${org.domain}:`, fetchError);
      });

      // Add a small delay to stagger requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return NextResponse.json({
      success: true,
      message: `Successfully triggered crons for ${organizations.length} organizations.`,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[CronTrigger] An unexpected error occurred:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: errorMessage
    }, { status: 500 });
  }
}
