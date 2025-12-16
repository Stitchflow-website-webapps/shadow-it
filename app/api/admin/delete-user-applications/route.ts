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
    
    // Delete user_applications for these users in batches to avoid URI size limits
    const BATCH_SIZE = 100; // Process 100 users at a time
    let totalDeleted = 0;
    let batchNumber = 1;
    console.log("User count: "+userIds.length)
    
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${batchNumber} (${batch.length} users)...`);
      
      const { error: deleteError } = await supabaseAdmin
        .from('user_applications')
        .delete()
        .in('user_id', batch);
      
      if (deleteError) {
        console.error(`Error deleting user applications in batch ${batchNumber}:`, deleteError);
        return NextResponse.json(
          { error: `Failed to delete user applications in batch ${batchNumber}` },
          { status: 500 }
        );
      }
      
      totalDeleted += batch.length;
      batchNumber++;
      
      // Small delay between batches to avoid overwhelming the database
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Now delete the users themselves from the users table
    console.log(`Deleting ${userIds.length} users from users table...`);
    let userBatchNumber = 1;
    
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      console.log(`Deleting user batch ${userBatchNumber} (${batch.length} users)...`);
      
      const { error: deleteUsersError } = await supabaseAdmin
        .from('users')
        .delete()
        .in('id', batch);
      
      if (deleteUsersError) {
        console.error(`Error deleting users in batch ${userBatchNumber}:`, deleteUsersError);
        return NextResponse.json(
          { error: `Failed to delete users in batch ${userBatchNumber}` },
          { status: 500 }
        );
      }
      
      userBatchNumber++;
      
      // Small delay between batches to avoid overwhelming the database
      if (i + BATCH_SIZE < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return NextResponse.json({ 
      message: `Successfully deleted user applications and users for organization: ${organization_id}`,
      deleted_user_applications: userIds.length,
      deleted_users: userIds.length,
      user_app_batches_processed: batchNumber - 1,
      user_batches_processed: userBatchNumber - 1
    });
    
  } catch (error: any) {
    console.error('Error in delete user applications API:', error);
    return NextResponse.json(
      { error: 'Failed to delete user applications' },
      { status: 500 }
    );
  }
} 