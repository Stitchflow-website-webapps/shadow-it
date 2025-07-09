import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const shadowOrgId = searchParams.get('shadowOrgId')

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    // Get the organization by shadow org ID
    const { data: organization, error: orgError } = await organizeSupabaseAdmin
      .from('organizations')
      .select('*')
      .eq('shadow_org_id', shadowOrgId)
      .single()

    if (orgError) {
      console.error('Error fetching organization:', orgError)
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json(organization)
  } catch (error) {
    console.error('Error in GET /api/organize/organization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { shadowOrgId, identity_provider, email_provider } = body

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    if (!identity_provider || !email_provider) {
      return NextResponse.json({ error: 'Identity provider and email provider are required' }, { status: 400 })
    }

    // Update the organization
    const { data: organization, error: updateError } = await organizeSupabaseAdmin
      .from('organizations')
      .update({
        identity_provider,
        email_provider,
        updated_at: new Date().toISOString()
      })
      .eq('shadow_org_id', shadowOrgId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating organization:', updateError)
      return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 })
    }

    return NextResponse.json(organization)
  } catch (error) {
    console.error('Error in PUT /api/organize/organization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 