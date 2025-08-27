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
      let organizations = null
      let orgError = null

      // First try to find organizations that contain this shadow org ID in comma-separated list
      const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('*')
        .not('shadow_org_id', 'is', null)

      if (!orgsError && orgs) {
        // Find organization that contains the shadow org ID in its comma-separated list
        const matchingOrg = orgs.find(org => {
          if (!org.shadow_org_id) return false
          const orgShadowIds = org.shadow_org_id.split(',').map((id: string) => id.trim())
          return orgShadowIds.includes(singleShadowOrgId)
        })
        
        if (matchingOrg) {
          organizations = [matchingOrg]
          orgError = null
        }
      }

      // If no comma-separated match found, try exact match
      if (!organizations || organizations.length === 0) {
        const { data: exactOrgs, error: exactError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('*')
          .eq('shadow_org_id', singleShadowOrgId)

        if (!exactError && exactOrgs && exactOrgs.length > 0) {
          organizations = exactOrgs
          orgError = null
        } else {
          orgError = exactError
        }
      }

      if (!orgError && organizations && organizations.length > 0) {
        // If there are multiple organizations, use the oldest one
        const organization = organizations.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )[0]

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
        let organizations = null
        let findError = null

        // First try to find organizations that contain this shadow org ID in comma-separated list
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('*')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const matchingOrgs = orgs.filter(org => {
            if (!org.shadow_org_id) return false
            const orgShadowIds = org.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (matchingOrgs.length > 0) {
            organizations = matchingOrgs
          }
        }

        // If no comma-separated match found, try exact match
        if (!organizations || organizations.length === 0) {
          const { data: exactOrgs, error: exactError } = await organizeSupabaseAdmin
            .from('organizations')
            .select('*')
            .eq('shadow_org_id', singleShadowOrgId)

          if (!exactError && exactOrgs && exactOrgs.length > 0) {
            organizations = exactOrgs
          } else {
            findError = exactError
          }
        }

        if (findError) {
          console.warn(`Failed to find organizations for shadow org ID: ${singleShadowOrgId}`, findError)
          continue
        }

        if (!organizations || organizations.length === 0) {
          console.warn(`No organizations found for shadow org ID: ${singleShadowOrgId}`)
          continue
        }

        // If there are multiple organizations, log a warning but proceed with the first one
        if (organizations.length > 1) {
          console.warn(`Multiple organizations found for shadow org ID: ${singleShadowOrgId}. Using the first one.`, {
            count: organizations.length,
            orgIds: organizations.map(org => org.id)
          })
        }

        // Use the first organization (oldest by creation date)
        const targetOrg = organizations.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )[0]

        // Update the target organization
        const { data: organization, error: updateError } = await organizeSupabaseAdmin
          .from('organizations')
          .update({
            identity_provider,
            email_provider,
            updated_at: new Date().toISOString()
          })
          .eq('id', targetOrg.id)
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