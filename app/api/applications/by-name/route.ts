import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PUT(request: NextRequest) {
  const supabase = supabaseAdmin
  try {
    const { appName, managementStatus, shadowOrgId } = await request.json()

    if (!appName || !managementStatus || !shadowOrgId) {
      return NextResponse.json({ error: 'appName, managementStatus, and shadowOrgId are required' }, { status: 400 })
    }

    // Find the application by name from the apps associated with the org
    const { data: appToUpdate, error: appError } = await supabase
        .from('applications')
        .select('id')
        .eq('name', appName)
        .eq('organization_id', shadowOrgId)
        .single();
    
    if (appError || !appToUpdate) {
      // App not found in Shadow IT for this org, which is fine.
      return NextResponse.json({ message: 'App not found in Shadow IT, no action taken.' });
    }

    // Update the application's managementStatus
    const { data: updatedApp, error: updateError } = await supabase
      .from('applications')
      .update({ management_status: managementStatus })
      .eq('id', appToUpdate.id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating application in shadow-it:', updateError)
      return NextResponse.json({ error: 'Failed to update application in Shadow IT' }, { status: 500 })
    }

    return NextResponse.json(updatedApp)
  } catch (error) {
    console.error('Error in PUT /api/applications/by-name:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 