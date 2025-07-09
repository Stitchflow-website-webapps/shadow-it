import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function PUT(request: NextRequest) {
  try {
    const { orgId, identityProvider, emailProvider } = await request.json()

    if (!orgId || !identityProvider || !emailProvider) {
      return NextResponse.json({ error: 'Organization ID, identity provider, and email provider are required' }, { status: 400 })
    }

    // Update the organization
    const { data: updatedOrg, error: orgError } = await supabaseServer
      .from('organizations')
      .update({
        identity_provider: identityProvider,
        email_provider: emailProvider,
        updated_at: new Date().toISOString()
      })
      .eq('id', orgId)
      .select()
      .single()

    if (orgError) {
      console.error('Error updating organization:', orgError)
      return NextResponse.json({ error: 'Failed to update organization settings' }, { status: 500 })
    }

    // Update all apps in this organization to inherit the new settings
    const { error: appsError } = await supabaseServer
      .from('apps')
      .update({
        identity_provider: identityProvider,
        email_provider: emailProvider,
        updated_at: new Date().toISOString()
      })
      .eq('org_id', orgId)

    if (appsError) {
      console.error('Error updating apps with new org settings:', appsError)
      // Don't fail the request, but log the error
    }

    return NextResponse.json({
      organization: {
        id: updatedOrg.id,
        name: updatedOrg.name,
        identityProvider: updatedOrg.identity_provider,
        emailProvider: updatedOrg.email_provider
      }
    })
  } catch (error) {
    console.error('Organization settings update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 