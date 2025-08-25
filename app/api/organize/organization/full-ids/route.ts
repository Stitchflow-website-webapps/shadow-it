import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const shadowOrgId = searchParams.get('shadowOrgId')

    if (!shadowOrgId) {
      return NextResponse.json({ error: 'Shadow org ID is required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - find which org contains this shadow org ID
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    // Try each shadow org ID to find which one contains the shadow org ID
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: organization, error: orgError } = await organizeSupabaseAdmin
        .from('organizations')
        .select('shadow_org_id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (orgError || !organization) {
        const { data: orgs, error: orgsError } = await organizeSupabaseAdmin
          .from('organizations')
          .select('shadow_org_id')
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
        // Return the full comma-separated shadow org IDs
        return NextResponse.json({ 
          fullShadowOrgIds: organization.shadow_org_id,
          sourceShadowOrgId: singleShadowOrgId
        })
      }
    }

    // If no organization found for any shadow org ID
    return NextResponse.json({ error: 'Organization not found for any provided shadow org IDs' }, { status: 404 })
  } catch (error) {
    console.error('Error in GET /api/organize/organization/full-ids:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
