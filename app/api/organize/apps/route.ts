import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin, type OrganizeApp } from '@/lib/supabase/organize-client'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const shadowOrgId = searchParams.get('shadowOrgId')

    console.log('GET /api/organize/apps - shadowOrgId:', shadowOrgId)

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs (for cases like Zurabio with multiple shadow orgs)
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    let allApps: any[] = []

    // Fetch apps for each shadow org ID
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: organizeOrg, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !organizeOrg) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('id, shadow_org_id')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const matchingOrg = orgs.find(org => {
            if (!org.shadow_org_id) return false
            const orgShadowIds = org.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (matchingOrg) {
            organizeOrg = { id: matchingOrg.id }
            orgError = null // Clear the error since we found a match
          }
        }
      }

      if (orgError || !organizeOrg) {
        console.warn(`Organization not found for shadow org ID: ${singleShadowOrgId}`)
        continue // Skip this shadow org ID and continue with others
      }

      // Get all apps for this organization
      const { data: apps, error: appsError } = await organizeSupabaseAdmin
        .from('apps')
        .select('*')
        .eq('org_id', organizeOrg.id)
        .order('created_at', { ascending: false })

      if (appsError) {
        console.error(`Error fetching apps for shadow org ${singleShadowOrgId}:`, appsError)
        continue // Skip this shadow org ID and continue with others
      }

      if (apps && apps.length > 0) {
        // Add shadow_org_id to each app for tracking which org it belongs to
        const appsWithShadowOrgId = apps.map(app => ({
          ...app,
          source_shadow_org_id: singleShadowOrgId
        }))
        allApps = [...allApps, ...appsWithShadowOrgId]
      }
    }

    // Remove duplicates based on app name (in case same app exists in multiple shadow orgs)
    const uniqueApps = allApps.reduce((acc: any[], current: any) => {
      const existingApp = acc.find((app: any) => app.name.toLowerCase() === current.name.toLowerCase())
      if (!existingApp) {
        acc.push(current)
      } else {
        // If duplicate found, keep the one with more recent updated_at
        if (new Date(current.updated_at) > new Date(existingApp.updated_at)) {
          const index = acc.findIndex((app: any) => app.name.toLowerCase() === current.name.toLowerCase())
          acc[index] = current
        }
      }
      return acc
    }, [] as any[])

    // Sort by created_at descending
    uniqueApps.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json(uniqueApps)
  } catch (error) {
    console.error('Error in GET /api/organize/apps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { app, shadowOrgId } = body

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    if (!app || !app.name) {
      return NextResponse.json({ error: 'App name is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - use the first valid one for creating new apps
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    let organizeOrg = null
    let usedShadowOrgId = null

    // Try each shadow org ID until we find a valid one
    for (const singleShadowOrgId of shadowOrgIds) {
      const { data: org, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      if (!orgError && org) {
        organizeOrg = org
        usedShadowOrgId = singleShadowOrgId
        break
      }
    }

    if (!organizeOrg) {
      return NextResponse.json({ error: 'No valid organization found for provided shadow org IDs' }, { status: 404 })
    }

    // Create the app with default vendor files values
    const { data: newApp, error: createError } = await organizeSupabaseAdmin
      .from('apps')
      .insert({
        ...app,
        org_id: organizeOrg.id,
        vendor_files: app.vendor_files || [],
        vendor_files_limit: app.vendor_files ? app.vendor_files.length : 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating app:', createError)
      return NextResponse.json({ error: 'Failed to create app' }, { status: 500 })
    }

    // Add the source shadow org ID to the response for tracking
    const appWithSource = {
      ...newApp,
      source_shadow_org_id: usedShadowOrgId
    }

    return NextResponse.json(appWithSource)
  } catch (error) {
    console.error('Error in POST /api/organize/apps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { app, shadowOrgId } = body

    console.log('PUT /api/organize/apps - shadowOrgId:', shadowOrgId)
    console.log('PUT /api/organize/apps - app:', app)

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    if (!app || !app.id) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - find which org contains this app
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    let organizeOrg = null
    let usedShadowOrgId = null

    // Try each shadow org ID to find which one contains the app
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: org, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !org) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('id, shadow_org_id')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const matchingOrg = orgs.find(orgItem => {
            if (!orgItem.shadow_org_id) return false
            const orgShadowIds = orgItem.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (matchingOrg) {
            org = { id: matchingOrg.id }
            orgError = null // Clear the error since we found a match
          }
        }
      }

      if (!orgError && org) {
        // Check if the app exists in this organization
        const { data: existingApp, error: appError } = await organizeSupabaseAdmin
          .from('apps')
          .select('id')
          .eq('id', app.id)
          .eq('org_id', org.id)
          .single()

        if (!appError && existingApp) {
          organizeOrg = org
          usedShadowOrgId = singleShadowOrgId
          break
        }
      }
    }

    if (!organizeOrg) {
      return NextResponse.json({ error: 'App not found in any of the provided organizations' }, { status: 404 })
    }

    // Update the app
    const updateData = {
      ...app,
      org_id: organizeOrg.id,
      updated_at: new Date().toISOString()
    }

    const { data: updatedApp, error: updateError } = await organizeSupabaseAdmin
      .from('apps')
      .update(updateData)
      .eq('id', app.id)
      .eq('org_id', organizeOrg.id) // Ensure app belongs to the org
      .select()
      .single()

    if (updateError) {
      console.error('Error updating app:', updateError)
      return NextResponse.json({ error: 'Failed to update app' }, { status: 500 })
    }

    // Add the source shadow org ID to the response for tracking
    const appWithSource = {
      ...updatedApp,
      source_shadow_org_id: usedShadowOrgId
    }

    return NextResponse.json(appWithSource)
  } catch (error) {
    console.error('Error in PUT /api/organize/apps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const appId = searchParams.get('appId')
    const shadowOrgId = searchParams.get('shadowOrgId')

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    if (!appId) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - find which org contains this app
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    let organizeOrg = null

    // Try each shadow org ID to find which one contains the app
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: org, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !org) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('id, shadow_org_id')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const matchingOrg = orgs.find(orgItem => {
            if (!orgItem.shadow_org_id) return false
            const orgShadowIds = orgItem.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (matchingOrg) {
            org = { id: matchingOrg.id }
            orgError = null // Clear the error since we found a match
          }
        }
      }

      if (!orgError && org) {
        // Check if the app exists in this organization
        const { data: existingApp, error: appError } = await organizeSupabaseAdmin
          .from('apps')
          .select('id')
          .eq('id', appId)
          .eq('org_id', org.id)
          .single()

        if (!appError && existingApp) {
          organizeOrg = org
          break
        }
      }
    }

    if (!organizeOrg) {
      return NextResponse.json({ error: 'App not found in any of the provided organizations' }, { status: 404 })
    }

    // Get app data to check for files that need to be deleted
    const { data: appData, error: fetchError } = await organizeSupabaseAdmin
      .from('apps')
      .select('contract_url, vendor_files')
      .eq('id', appId)
      .eq('org_id', organizeOrg.id)
      .single()

    if (fetchError) {
      console.error('Error fetching app data for deletion:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch app data' }, { status: 500 })
    }

    // Clean up contract file if it exists
    if (appData?.contract_url) {
      try {
        const fileMetadata = JSON.parse(appData.contract_url)
        if (fileMetadata.type === 'uploaded_file' && fileMetadata.filePath) {
          const { error: deleteFileError } = await supabaseServer.storage
            .from('organize-app-inbox-contracts')
            .remove([fileMetadata.filePath])

          if (deleteFileError) {
            console.error('Error deleting contract file:', deleteFileError)
            // Continue with deletion even if file cleanup fails
          }
        }
      } catch {
        // If parsing fails, it might be a legacy URL - skip file deletion
        console.log('Skipping contract file deletion for legacy URL or invalid metadata')
      }
    }

    // Clean up vendor files if they exist
    if (appData?.vendor_files && Array.isArray(appData.vendor_files)) {
      const filePaths = appData.vendor_files.map((file: any) => file.filePath).filter(Boolean)

      if (filePaths.length > 0) {
        try {
          const { error: deleteVendorFilesError } = await supabaseServer.storage
            .from('organize-app-inbox-contracts')
            .remove(filePaths)

          if (deleteVendorFilesError) {
            console.error('Error deleting vendor files:', deleteVendorFilesError)
            // Continue with deletion even if file cleanup fails
          }
        } catch (error) {
          console.error('Error during vendor files cleanup:', error)
          // Continue with deletion even if file cleanup fails
        }
      }
    }

    // Delete the app
    const { error: deleteError } = await organizeSupabaseAdmin
      .from('apps')
      .delete()
      .eq('id', appId)
      .eq('org_id', organizeOrg.id) // Ensure app belongs to the org

    if (deleteError) {
      console.error('Error deleting app:', deleteError)
      return NextResponse.json({ error: 'Failed to delete app' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/organize/apps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 