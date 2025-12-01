import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Types for organize-app-inbox schema
export interface OrganizeOrganization {
  id: string
  name: string
  domain: string | null
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

// Type for individual vendor file metadata
export interface VendorFile {
  id: string
  fileName: string
  label: string
  filePath: string
  uploadedAt: string
  fileType: string
  url?: string
}

// Import AppSKU type
import type { AppSKU } from '@/types/app'

export interface OrganizeApp {
  id: string
  name: string
  sso_enforced: string | null
  deprovisioning: string | null
  stitchflow_status: string | null
  app_tier: string | null
  department: string | null
  technical_owner: string | null // renamed from owner
  comment: string | null
  billing_frequency: string | null // renamed from app_plan
  plan_limit: string | null
  plan_reference: string | null
  cost_per_user: string | null
  renewal_date: string | null
  contract_url: string | null
  vendor_files: VendorFile[] | null
  vendor_files_limit: number | null // Count of uploaded vendor files (not the maximum allowed)
  // New fields for License & Renewal
  renewal_type: string | null
  billing_owner: string | null
  purchase_category: string | null
  opt_out_date: string | null
  opt_out_period: number | null
  vendor_contract_status: string | null
  payment_method: string | null
  payment_terms: string | null
  budget_source: string | null
  org_id: string
  created_at: string
  updated_at: string
  managed_status: string | null
  licenses_used: number | null
  usage_description: string | null
  // Multi-SKU fields
  is_multi_sku_enabled: boolean | null
  skus: AppSKU[] | null
  source_shadow_org_id?: string // Optional field added by API for tracking which shadow org the app belongs to
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