import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const shadowOrgId = searchParams.get('shadowOrgId')

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - return settings from the first available organization
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    // Try each shadow org ID until we find a valid organization
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: organization, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('*')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !organization) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('*')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          organization = orgs.find(org => {
            if (!org.shadow_org_id) return false
            const orgShadowIds = org.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (organization) {
            orgError = null // Clear the error since we found a match
          }
        }
      }

      if (!orgError && organization) {
        // Add info about which shadow org ID was used
        const orgWithSource = {
          ...organization,
          source_shadow_org_id: singleShadowOrgId
        }
        return NextResponse.json(orgWithSource)
      }
    }

    // If no organization found for any shadow org ID
    return NextResponse.json({ error: 'Organization not found for any provided shadow org IDs' }, { status: 404 })
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

    // Handle comma-separated shadow org IDs - update all organizations
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    const updatedOrganizations = []
    let lastSuccessfulUpdate = null

    // Update all organizations that match the shadow org IDs
    for (const singleShadowOrgId of shadowOrgIds) {
      try {
        const { data: organization, error: updateError } = await organizeSupabaseAdmin
          .from('organizations')
          .update({
            identity_provider,
            email_provider,
            updated_at: new Date().toISOString()
          })
          .eq('shadow_org_id', singleShadowOrgId)
          .select()
          .single()

        if (!updateError && organization) {
          updatedOrganizations.push({
            ...organization,
            source_shadow_org_id: singleShadowOrgId
          })
          lastSuccessfulUpdate = {
            ...organization,
            source_shadow_org_id: singleShadowOrgId
          }
        } else {
          console.warn(`Failed to update organization for shadow org ID: ${singleShadowOrgId}`, updateError)
        }
      } catch (error) {
        console.error(`Error updating organization for shadow org ID: ${singleShadowOrgId}`, error)
      }
    }

    if (updatedOrganizations.length === 0) {
      return NextResponse.json({ error: 'Failed to update any organizations' }, { status: 500 })
    }

    // Return the last successfully updated organization (for consistency with single org behavior)
    return NextResponse.json(lastSuccessfulUpdate)
  } catch (error) {
    console.error('Error in PUT /api/organize/organization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 