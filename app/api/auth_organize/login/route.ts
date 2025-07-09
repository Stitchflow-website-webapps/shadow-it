import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { supabaseServer } from '@/lib/supabase-server'
import type { LoginCredentials } from '@/types/auth'

// Helper function to create the first user and organization
async function createFirstUser(username: string, password: string): Promise<NextResponse> {
  try {
    const passwordHash = await bcrypt.hash(password, 10)

    const { data: newOrg, error: orgError } = await supabaseServer
      .from('organizations')
      .insert([{ name: `${username}'s Organization` }])
      .select('*')
      .single()

    if (orgError || !newOrg) {
      console.error('Error creating organization for first user:', orgError)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }

    const { data: newUser, error: userError } = await supabaseServer
      .from('users')
      .insert([{ username, password_hash: passwordHash, org_id: newOrg.id }])
      .select('*')
      .single()

    if (userError || !newUser) {
      console.error('Error creating first user:', userError)
      await supabaseServer.from('organizations').delete().eq('id', newOrg.id) // Cleanup
      return NextResponse.json({ error: 'Failed to create user account' }, { status: 500 })
    }

    const { password_hash, ...userWithoutPassword } = newUser
    return NextResponse.json({
      user: {
        id: userWithoutPassword.id,
        username: userWithoutPassword.username,
        orgId: userWithoutPassword.org_id
      },
      organization: newOrg,
      isFirstUser: true
    }, { status: 201 })

  } catch (error) {
    console.error('Exception in createFirstUser:', error)
    return NextResponse.json({ error: 'Failed to set up first user account' }, { status: 500 })
  }
}

// Helper function to create a new user when others exist
async function createNewUser(username: string, password: string): Promise<NextResponse> {
  try {
    const passwordHash = await bcrypt.hash(password, 10)

    const { data: newOrg, error: orgError } = await supabaseServer
      .from('organizations')
      .insert([{ name: `${username}'s Organization` }])
      .select('*')
      .single()

    if (orgError || !newOrg) {
      console.error('Error creating organization for new user:', orgError)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }

    const { data: newUser, error: userError } = await supabaseServer
      .from('users')
      .insert([{ username, password_hash: passwordHash, org_id: newOrg.id }])
      .select('*')
      .single()

    if (userError || !newUser) {
      console.error('Error creating new user:', userError)
      await supabaseServer.from('organizations').delete().eq('id', newOrg.id) // Cleanup
      return NextResponse.json({ error: 'Failed to create user account' }, { status: 500 })
    }

    const { password_hash, ...userWithoutPassword } = newUser
    return NextResponse.json({
      user: {
        id: userWithoutPassword.id,
        username: userWithoutPassword.username,
        orgId: userWithoutPassword.org_id
      },
      organization: newOrg,
      isNewUser: true // Differentiates from first user, can be used on frontend
    }, { status: 201 })

  } catch (error) {
    console.error('Exception in createNewUser:', error)
    return NextResponse.json({ error: 'Failed to create new account' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { username, password }: LoginCredentials = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    // Check if any users exist
    const { data: existingUsers, error: userCheckError } = await supabaseServer
      .from('users')
      .select('id', { count: 'exact' })
      .limit(1)

    if (userCheckError) {
      console.error('Error checking for existing users:', userCheckError)
      return NextResponse.json({ error: 'Authentication system error' }, { status: 500 })
    }

    // If no users exist, create the first user
    if (!existingUsers || existingUsers.length === 0) {
      return await createFirstUser(username, password)
    }

    // Normal flow: user might exist or need to be created
    const { data: user, error: loginError } = await supabaseServer
      .from('users')
      .select('*')
      .eq('username', username)
      .single()

    // If user does not exist (PGRST116), create a new one
    if (loginError && loginError.code === 'PGRST116') {
      return await createNewUser(username, password)
    }
    
    if (loginError || !user) {
      console.error('Database error during login:', loginError)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    // Verify password for existing user
    const isValidPassword = await bcrypt.compare(password, user.password_hash)
    if (!isValidPassword) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }
    
    // Get organization data for the existing user
    const { data: organization, error: orgError } = await supabaseServer
        .from('organizations')
        .select('*')
        .eq('id', user.org_id)
        .single()
    
    if (orgError || !organization) {
        return NextResponse.json({ error: 'Could not find organization for user' }, { status: 500 })
    }

    const { password_hash, ...userWithoutPassword } = user
    // Return user and organization data
    return NextResponse.json({
      user: {
        id: userWithoutPassword.id,
        username: userWithoutPassword.username,
        orgId: userWithoutPassword.org_id
      },
      organization
    })
  } catch (error) {
    console.error('Login route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 