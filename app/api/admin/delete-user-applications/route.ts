import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Simple admin key for authorization
const ADMIN_KEY = process.env.ADMIN_KEY;

export async function POST(request: Request) {
  try {
    // Check for admin authorization
    const authHeader = request.headers.get('Admin-Authorization');
    
    if (!authHeader || authHeader !== ADMIN_KEY) {
      console.log('Auth failed. Received:', authHeader, 'Expected:', ADMIN_KEY);
      return NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 401 }
      );
    }
    
    const { organization_id } = await request.json();
    
    if (!organization_id) {
      return NextResponse.json(
        { error: 'Missing organization_id parameter' },
        { status: 400 }
      );
    }
    
    console.log(`Deleting user applications for organization: ${organization_id}`);
    
    // First, get all users that belong to this organization
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organization_id', organization_id);
    
    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }
    
    if (!users || users.length === 0) {
      return NextResponse.json({ message: 'No users found for this organization' });
    }
    
    // Extract user IDs
    const userIds = users.map(user => user.id);
    
    // Delete user_applications in batches to avoid URI length limits
    const BATCH_SIZE = 100; // Process 100 users at a time
    let totalDeleted = 0;
    
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      
      const { error: deleteError } = await supabaseAdmin
        .from('user_applications')
        .delete()
        .in('user_id', batch);
      
      if (deleteError) {
        console.error(`Error deleting user applications batch ${i}-${i + batch.length}:`, deleteError);
        return NextResponse.json(
          { error: `Failed to delete user applications at batch ${i}-${i + batch.length}` },
          { status: 500 }
        );
      }
      
      totalDeleted += batch.length;
      console.log(`Processed batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(userIds.length/BATCH_SIZE)}: ${batch.length} users`);
    }
    
    return NextResponse.json({ 
      message: `Successfully deleted user applications for organization: ${organization_id}`,
      deleted_count: userIds.length
    });
    
  } catch (error: any) {
    console.error('Error in delete user applications API:', error);
    return NextResponse.json(
      { error: 'Failed to delete user applications' },
      { status: 500 }
    );
  }
} 