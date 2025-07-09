import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Get user data
    const { data: userData, error: userError } = await supabaseServer
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 })
    }

    // Get organization data
    const { data: orgData, error: orgError } = await supabaseServer
      .from('organizations')
      .select('*')
      .eq('id', userData.org_id)
      .single()

    if (orgError || !orgData) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 500 })
    }

    // Return user and organization data (excluding password hash)
    const { password_hash, ...userWithoutPassword } = userData
    
    return NextResponse.json({
      user: {
        id: userWithoutPassword.id,
        username: userWithoutPassword.username,
        orgId: userWithoutPassword.org_id,
        createdAt: userWithoutPassword.created_at,
        updatedAt: userWithoutPassword.updated_at
      },
      organization: {
        id: orgData.id,
        name: orgData.name,
        identityProvider: orgData.identity_provider || '',
        emailProvider: orgData.email_provider || '',
        createdAt: orgData.created_at,
        updatedAt: orgData.updated_at
      }
    })
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 