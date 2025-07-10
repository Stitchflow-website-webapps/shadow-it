import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const missingOrgId = 'c98ce982-b9e1-4500-88bd-56b6c6141c27';
    
    console.log('Checking if organization exists...');
    
    // Check if organization already exists
    const { data: existingOrg, error: checkError } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', missingOrgId)
      .single();
    
    if (existingOrg) {
      console.log('Organization already exists:', existingOrg);
      return NextResponse.json({ 
        success: true, 
        message: 'Organization already exists', 
        organization: existingOrg 
      });
    }
    
    console.log('Organization does not exist, creating it...');
    
    // Create the missing organization
    const { data: newOrg, error: insertError } = await supabaseAdmin
      .from('organizations')
      .insert({
        id: missingOrgId,
        name: 'Default Organization',
        domain: 'default.com',
        auth_provider: 'google',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        first_admin: 'system@default.com'
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('Error creating organization:', insertError);
      throw insertError;
    }
    
    console.log('Successfully created organization:', newOrg);
    
    // Verify the organization was created
    const { data: verifyOrg, error: verifyError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, domain, auth_provider, created_at')
      .eq('id', missingOrgId)
      .single();
    
    if (verifyError) {
      console.error('Error verifying organization:', verifyError);
      throw verifyError;
    }
    
    console.log('Organization verification successful:', verifyOrg);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Organization created successfully', 
      organization: verifyOrg 
    });
    
  } catch (error) {
    console.error('Error in fix-organization endpoint:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: 'Use POST to fix the missing organization' 
  });
}