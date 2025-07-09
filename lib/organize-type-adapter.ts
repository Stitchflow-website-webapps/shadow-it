import type { OrganizeApp } from '@/lib/supabase/organize-client'
import type { App } from '@/types/app'

// Convert OrganizeApp to App for compatibility with existing components
export function organizeAppToApp(organizeApp: OrganizeApp): App {
  return {
    id: organizeApp.id,
    name: organizeApp.name,
    identityProvider: '',
    emailProvider: '',
    ssoEnforced: organizeApp.sso_enforced || '',
    deprovisioning: organizeApp.deprovisioning || '',
    managedStatus: organizeApp.managed_status || 'Unknown',
    stitchflowStatus: organizeApp.stitchflow_status || '',
    appTier: organizeApp.app_tier || '',
    department: organizeApp.department || '',
    owner: organizeApp.owner || '',
    comment: organizeApp.comment || '',
    appPlan: organizeApp.app_plan || '',
    planLimit: organizeApp.plan_limit || '',
    planReference: organizeApp.plan_reference || '',
    costPerUser: organizeApp.cost_per_user || '',
    renewalDate: organizeApp.renewal_date || '',
    contractUrl: organizeApp.contract_url || '',
    licensesUsed: organizeApp.licenses_used,
    usageDescription: organizeApp.usage_description || ''
  }
}

// Convert App to OrganizeApp for API calls
export function appToOrganizeApp(app: App, orgId: string): Partial<OrganizeApp> {
  return {
    id: app.id,
    name: app.name,
    department: app.department || null,
    licenses_used: app.licensesUsed,
    owner: app.owner,
    comment: app.comment || null,
    sso_enforced: app.ssoEnforced || null,
    managed_status: app.managedStatus,
    org_id: orgId,
    stitchflow_status: app.stitchflowStatus || null,
    app_tier: app.appTier || null,
    deprovisioning: app.deprovisioning || null,
    app_plan: app.appPlan || null,
    plan_limit: app.planLimit || null,
    plan_reference: app.planReference || null,
    cost_per_user: app.costPerUser || null,
    renewal_date: app.renewalDate || null,
    contract_url: app.contractUrl || null,
    usage_description: app.usageDescription || null
  }
} 