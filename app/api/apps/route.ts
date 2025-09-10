import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { App } from '@/types/app'

// Helper function to convert database app to frontend format
const mapDatabaseAppToApp = (dbApp: any): App => ({
  id: dbApp.id,
  name: dbApp.name,
  identityProvider: '',
  emailProvider: '',
  ssoEnforced: dbApp.sso_enforced || '',
  deprovisioning: dbApp.deprovisioning || '',
  managedStatus: dbApp.managed_status || '',
  stitchflowStatus: dbApp.stitchflow_status || '',
  appTier: dbApp.app_tier || '',
  department: dbApp.department || '',
  owner: dbApp.owner || '',
  comment: dbApp.comment || '',
  appPlan: dbApp.app_plan || '',
  planLimit: dbApp.plan_limit || '',
  planReference: dbApp.plan_reference || '',
  costPerUser: dbApp.cost_per_user || '',
  renewalDate: dbApp.renewal_date || '',
  contractUrl: dbApp.contract_url || '',
  licensesUsed: dbApp.licenses_used,
  usageDescription: dbApp.usage_description || ''
})

// Helper function to convert frontend app to database format
const mapAppToDatabaseApp = (app: App, orgId: string) => ({
  id: app.id,
  name: app.name,
  sso_enforced: app.ssoEnforced,
  deprovisioning: app.deprovisioning,
  managed_status: app.managedStatus,
  stitchflow_status: app.stitchflowStatus,
  app_tier: app.appTier,
  department: app.department,
  owner: app.owner,
  comment: app.comment,
  app_plan: app.appPlan,
  plan_limit: app.planLimit,
  plan_reference: app.planReference,
  cost_per_user: app.costPerUser,
  renewal_date: app.renewalDate,
  contract_url: app.contractUrl,
  licenses_used: app.licensesUsed,
  usage_description: app.usageDescription,
  org_id: orgId
})

// Helper function to convert frontend app to database format for creation
const mapAppToDatabaseAppForCreation = (app: App, orgId: string) => ({
  id: app.id,
  name: app.name,
  sso_enforced: app.ssoEnforced,
  deprovisioning: app.deprovisioning,
  managed_status: app.managedStatus,
  stitchflow_status: app.stitchflowStatus,
  app_tier: app.appTier,
  department: app.department,
  owner: app.owner,
  comment: app.comment,
  app_plan: app.appPlan,
  plan_limit: app.planLimit,
  plan_reference: app.planReference,
  cost_per_user: app.costPerUser,
  renewal_date: app.renewalDate,
  contract_url: app.contractUrl,
  licenses_used: app.licensesUsed,
  usage_description: app.usageDescription,
  org_id: orgId
})

// GET /api/apps?orgId=xxx
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 })
    }

    const { data, error } = await supabaseServer
      .from('apps')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching apps:', error)
      return NextResponse.json({ error: 'Failed to fetch apps' }, { status: 500 })
    }

    const apps = data.map(mapDatabaseAppToApp)
    return NextResponse.json({ apps })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/apps
export async function POST(request: NextRequest) {
  try {
    const { app, orgId } = await request.json()

    if (!app || !orgId) {
      return NextResponse.json({ error: 'App data and organization ID are required' }, { status: 400 })
    }

    const dbApp = mapAppToDatabaseAppForCreation(app, orgId)
    
    // Remove the ID so database can generate a proper UUID
    const { id, ...dbAppWithoutId } = dbApp
    
    const { data, error } = await supabaseServer
      .from('apps')
      .insert([dbAppWithoutId])
      .select()
      .single()

    if (error) {
      console.error('Error saving app:', error)
      return NextResponse.json({ error: 'Failed to save app' }, { status: 500 })
    }

    const savedApp = mapDatabaseAppToApp(data)
    return NextResponse.json({ app: savedApp }, { status: 201 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/apps
export async function PUT(request: NextRequest) {
  try {
    const { app, orgId } = await request.json()

    if (!app || !orgId || !app.id) {
      return NextResponse.json({ error: 'App data with ID and organization ID are required' }, { status: 400 })
    }

    const dbApp = mapAppToDatabaseApp(app, orgId)
    
    // Remove the ID from update data (we use it in the WHERE clause)
    const { id, ...updateData } = dbApp
    
    const { data, error } = await supabaseServer
      .from('apps')
      .update(updateData)
      .eq('id', app.id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      console.error('Error updating app:', error)
      return NextResponse.json({ error: 'Failed to update app' }, { status: 500 })
    }

    const updatedApp = mapDatabaseAppToApp(data)
    return NextResponse.json({ app: updatedApp })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/apps?id=xxx&orgId=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const orgId = searchParams.get('orgId')

    if (!id || !orgId) {
      return NextResponse.json({ error: 'App ID and organization ID are required' }, { status: 400 })
    }

    // First, get the app to check for uploaded files (contract and vendor files)
    const { data: appData, error: fetchError } = await supabaseServer
      .from('apps')
      .select('contract_url, vendor_files')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (fetchError) {
      console.error('Error fetching app for deletion:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch app for deletion' }, { status: 500 })
    }

    // Clean up contract file if it exists
    if (appData?.contract_url) {
      try {
        // Check if it's an uploaded file with metadata
        const fileMetadata = JSON.parse(appData.contract_url)
        if (fileMetadata.type === 'uploaded_file' && fileMetadata.filePath) {
          // Delete the file from storage
          const { error: deleteFileError } = await supabaseServer.storage
            .from('organize-app-inbox-contracts')
            .remove([fileMetadata.filePath])

          if (deleteFileError) {
            console.error('Error deleting contract file:', deleteFileError)
            // Continue with app deletion even if file deletion fails
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
            // Continue with app deletion even if file deletion fails
          }
        } catch (error) {
          console.error('Error during vendor files cleanup:', error)
          // Continue with app deletion even if file deletion fails
        }
      }
    }

    // Now delete the app record
    const { error } = await supabaseServer
      .from('apps')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      console.error('Error deleting app:', error)
      return NextResponse.json({ error: 'Failed to delete app' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in app deletion process:', error)
    return NextResponse.json({ error: 'Internal server error during deletion' }, { status: 500 })
  }
} 