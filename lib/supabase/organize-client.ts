import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Types for organize-app-inbox schema
export interface OrganizeOrganization {
  id: string
  name: string
  created_at: string
  updated_at: string
  identity_provider: string
  email_provider: string
  shadow_org_id: string | null
}

export interface OrganizeUser {
  id: string
  username: string
  password_hash: string
  org_id: string
  created_at: string
  updated_at: string
}

export interface OrganizeApp {
  id: string
  name: string
  sso_enforced: string | null
  deprovisioning: string | null
  stitchflow_status: string | null
  app_tier: string | null
  department: string | null
  owner: string | null
  comment: string | null
  app_plan: string | null
  plan_limit: string | null
  plan_reference: string | null
  cost_per_user: string | null
  renewal_date: string | null
  contract_url: string | null
  org_id: string
  created_at: string
  updated_at: string
  managed_status: string | null
  licenses_used: number | null
  usage_description: string | null
}

export interface OrganizeDatabase {
  'organize-app-inbox': {
    organizations: OrganizeOrganization
    users: OrganizeUser
    apps: OrganizeApp
  }
}

// Create the organize-app-inbox specific client
export const organizeSupabase = createClient<OrganizeDatabase>(
  supabaseUrl,
  supabaseServiceKey,
  {
    db: {
      schema: 'organize-app-inbox'
    },
    auth: {
      persistSession: false
    }
  }
)

// Admin client for server-side operations
export const organizeSupabaseAdmin = organizeSupabase 