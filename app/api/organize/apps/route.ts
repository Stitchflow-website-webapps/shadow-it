import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin, type OrganizeApp } from '@/lib/supabase/organize-client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const shadowOrgId = searchParams.get('shadowOrgId')

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    // First get the organize org ID from shadow org ID
    const { data: organizeOrg, error: orgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('id')
      .eq('shadow_org_id', shadowOrgId)
      .single()

    if (orgError || !organizeOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Get all apps for this organization
    const { data: apps, error: appsError } = await organizeSupabaseAdmin
      .from('apps')
      .select('*')
      .eq('org_id', organizeOrg.id)
      .order('created_at', { ascending: false })

    if (appsError) {
      console.error('Error fetching apps:', appsError)
      return NextResponse.json({ error: 'Failed to fetch apps' }, { status: 500 })
    }

    return NextResponse.json(apps || [])
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

    // First get the organize org ID from shadow org ID
    const { data: organizeOrg, error: orgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('id')
      .eq('shadow_org_id', shadowOrgId)
      .single()

    if (orgError || !organizeOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Create the app
    const { data: newApp, error: createError } = await organizeSupabaseAdmin
      .from('apps')
      .insert({
        ...app,
        org_id: organizeOrg.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating app:', createError)
      return NextResponse.json({ error: 'Failed to create app' }, { status: 500 })
    }

    return NextResponse.json(newApp)
  } catch (error) {
    console.error('Error in POST /api/organize/apps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { app, shadowOrgId } = body

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    if (!app || !app.id) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400 })
    }

    // First get the organize org ID from shadow org ID
    const { data: organizeOrg, error: orgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('id')
      .eq('shadow_org_id', shadowOrgId)
      .single()

    if (orgError || !organizeOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Update the app
    const { data: updatedApp, error: updateError } = await organizeSupabaseAdmin
      .from('apps')
      .update({
        ...app,
        org_id: organizeOrg.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', app.id)
      .eq('org_id', organizeOrg.id) // Ensure app belongs to the org
      .select()
      .single()

    if (updateError) {
      console.error('Error updating app:', updateError)
      return NextResponse.json({ error: 'Failed to update app' }, { status: 500 })
    }

    return NextResponse.json(updatedApp)
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

    // First get the organize org ID from shadow org ID
    const { data: organizeOrg, error: orgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('id')
      .eq('shadow_org_id', shadowOrgId)
      .single()

    if (orgError || !organizeOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
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