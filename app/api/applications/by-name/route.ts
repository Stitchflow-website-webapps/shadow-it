import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PUT(request: NextRequest) {
  const supabase = supabaseAdmin
  try {
    const { appName, managementStatus, shadowOrgId } = await request.json()

    console.log('PUT /api/applications/by-name - appName:', appName)
    console.log('PUT /api/applications/by-name - managementStatus:', managementStatus)
    console.log('PUT /api/applications/by-name - shadowOrgId:', shadowOrgId)

    if (!appName || !managementStatus || !shadowOrgId) {
      return NextResponse.json({ error: 'appName, managementStatus, and shadowOrgId are required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }



    // Try each shadow org ID to find the app and update ALL matching apps
    const appsToUpdate = []
    
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: app, error: error } = await supabase
          .from('applications')
          .select('id')
          .eq('name', appName)
          .eq('organization_id', singleShadowOrgId)
          .single();

      // If no exact match, try to find applications that contain this shadow org ID in comma-separated list
      if (error || !app) {
        const { data: apps, error: appsError } = await supabase
          .from('applications')
          .select('id, organization_id')
          .eq('name', appName)
          .not('organization_id', 'is', null)

        if (!appsError && apps) {
          // Find application that contains the shadow org ID in its comma-separated list
          const matchingApp = apps.find(appItem => {
            if (!appItem.organization_id) return false
            const appOrgIds = appItem.organization_id.split(',').map((id: string) => id.trim())
            return appOrgIds.includes(singleShadowOrgId)
          })
          
          if (matchingApp) {
            app = matchingApp
            error = null // Clear the error since we found a match
          }
        }
      }

      if (!error && app) {
        appsToUpdate.push(app)
      }
    }
    
    console.log('Found apps to update:', appsToUpdate.length)
    
    // Update ALL found apps
    const updatedApps = []
    for (const app of appsToUpdate) {
      console.log('Updating app with ID:', app.id)
      const { data: updatedApp, error: updateError } = await supabase
        .from('applications')
        .update({ management_status: managementStatus })
        .eq('id', app.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating application in shadow-it:', updateError)
        return NextResponse.json({ error: 'Failed to update application in Shadow IT' }, { status: 500 })
      }
      
      updatedApps.push(updatedApp)
    }
    
    if (updatedApps.length === 0) {
      // App not found in Shadow IT for any of the orgs, which is fine.
      return NextResponse.json({ message: 'App not found in Shadow IT, no action taken.' });
    }

    return NextResponse.json(updatedApps)
  } catch (error) {
    console.error('Error in PUT /api/applications/by-name:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 