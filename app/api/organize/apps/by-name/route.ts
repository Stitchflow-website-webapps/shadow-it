import { NextRequest, NextResponse } from 'next/server'
import { organizeSupabaseAdmin } from '@/lib/supabase/organize-client'
import type { AppIntegration } from '@/hooks/use-app-integrations'

async function getIntegrations(): Promise<AppIntegration[]> {
  try {
    const response = await fetch(
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/stitchflow-intg%20list-K5UBvEAIl4xhSgVYxIckYWH6WsdxMh.csv",
    )
    const csvText = await response.text()

    const lines = csvText.split("\n")
    const data: AppIntegration[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""))
      if (values.length >= 2) {
        const name = values[0]
        const status = values[1]

        if (name && status) {
          let mappedStatus = "Not connected"
          if (status.toLowerCase().includes("csv") && status.toLowerCase().includes("api coming soon")) {
            mappedStatus = "Yes - CSV Sync"
          } else if (status.toLowerCase().includes("api")) {
            mappedStatus = "Yes - API"
          } else if (status.toLowerCase().includes("csv")) {
            mappedStatus = "Yes - CSV Sync"
          }
          data.push({ name, connectionStatus: mappedStatus })
        }
      }
    }
    return data
  } catch (err) {
    console.error("Error fetching integrations for server-side creation:", err)
    return []
  }
}

export async function PUT(request: NextRequest) {
  const supabase = organizeSupabaseAdmin
  try {
    const { appName, managementStatus, shadowOrgId } = await request.json()

    if (!appName || !managementStatus || !shadowOrgId) {
      return NextResponse.json({ error: 'appName, managementStatus, and shadowOrgId are required' }, { status: 400 })
    }

    // Handle comma-separated shadow org IDs - find which org contains this shadow org ID
    const shadowOrgIds = shadowOrgId.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
    
    if (shadowOrgIds.length === 0) {
      return NextResponse.json({ error: 'Valid shadow org ID is required' }, { status: 400 })
    }

    let organization = null
    let orgError = null

    // Try each shadow org ID to find which one contains the shadow org ID
    for (const singleShadowOrgId of shadowOrgIds) {
      // First try exact match
      let { data: org, error: error } = await supabase
        .from('organizations')
        .select('id')
        .eq('shadow_org_id', singleShadowOrgId)
        .single()

      // If no exact match, try to find organizations that contain this shadow org ID in comma-separated list
      if (error || !org) {
        const { data: orgs, error: orgsError } = await supabase
          .from('organizations')
          .select('id, shadow_org_id')
          .not('shadow_org_id', 'is', null)

        if (!orgsError && orgs) {
          // Find organization that contains the shadow org ID in its comma-separated list
          const foundOrg = orgs.find(orgItem => {
            if (!orgItem.shadow_org_id) return false
            const orgShadowIds = orgItem.shadow_org_id.split(',').map((id: string) => id.trim())
            return orgShadowIds.includes(singleShadowOrgId)
          })
          
          if (foundOrg) {
            org = { id: foundOrg.id }
            error = null // Clear the error since we found a match
          }
        }
      }

      if (!error && org) {
        organization = org
        break
      }
    }

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found for any provided shadow org IDs' }, { status: 404 })
    }

    // Check if the app already exists in the apps table
    const { data: existingApp, error: findError } = await supabase
      .from('apps')
      .select('id')
      .eq('name', appName)
      .eq('org_id', organization.id)
      .single()

    if (findError && findError.code !== 'PGRST116') { // PGRST116: 'exact-one-row-not-found'
      console.error('Error finding app in App Inbox:', findError)
      return NextResponse.json({ error: 'Failed to check for app in App Inbox' }, { status: 500 })
    }

    // If app exists, update it
    if (existingApp) {
      const { data: updatedApp, error: updateError } = await supabase
        .from('apps')
        .update({ managed_status: managementStatus })
        .eq('id', existingApp.id)
        .eq('org_id', organization.id) // Ensure app belongs to the correct organization
        .select()
        .single()

      if (updateError) {
        console.error('Error updating app in App Inbox:', updateError)
        return NextResponse.json({ error: 'Failed to update app in App Inbox' }, { status: 500 })
      }
      return NextResponse.json({ status: 'updated', app: updatedApp })

    } else {
      // If app does not exist, create it
      const integrations = await getIntegrations()
      const integration = integrations.find(int => int.name.toLowerCase() === appName.toLowerCase())
      
      const connectionStatus = integration ? integration.connectionStatus : "Yes - CSV Sync"

      const { data: newApp, error: createError } = await supabase
        .from('apps')
        .insert({
          name: appName,
          managed_status: managementStatus,
          org_id: organization.id,
          stitchflow_status: connectionStatus,
          // Add default values for other non-nullable fields if necessary
        })
        .select()
        .single()
      
      if (createError) {
        console.error('Error creating app in App Inbox:', createError)
        return NextResponse.json({ error: 'Failed to create app in App Inbox' }, { status: 500 })
      }
      return NextResponse.json({ status: 'created', app: newApp }, { status: 201 })
    }

  } catch (error) {
    console.error('Error in PUT /api/organize/apps/by-name:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 