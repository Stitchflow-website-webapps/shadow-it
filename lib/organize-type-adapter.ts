import type { OrganizeApp } from '@/lib/supabase/organize-client'
import type { App, VendorFile } from '@/types/app'

// Convert OrganizeApp to App for compatibility with existing components
export function organizeAppToApp(organizeApp: OrganizeApp): App {
  return {
    id: organizeApp.id,
    name: organizeApp.name,
    identityProvider: '',
    emailProvider: '',
    ssoEnforced: organizeApp.sso_enforced || '',
    deprovisioning: organizeApp.deprovisioning || '',
    managedStatus: organizeApp.managed_status || 'Newly discovered',
    stitchflowStatus: organizeApp.stitchflow_status || '',
    appTier: organizeApp.app_tier || '',
    department: organizeApp.department || '',
    technicalOwner: organizeApp.technical_owner || '',
    comment: organizeApp.comment || '',
    billingFrequency: organizeApp.billing_frequency || '',
    planLimit: organizeApp.plan_limit || '',
    planReference: organizeApp.plan_reference || '',
    costPerUser: organizeApp.cost_per_user || '',
    renewalDate: organizeApp.renewal_date || '',
    contractUrl: organizeApp.contract_url || '',
    vendorFiles: organizeApp.vendor_files || [],
    vendorFilesLimit: organizeApp.vendor_files ? organizeApp.vendor_files.length : 0,
    licensesUsed: organizeApp.licenses_used,
    usageDescription: organizeApp.usage_description || '',
    // New fields
    renewalType: organizeApp.renewal_type || '',
    billingOwner: organizeApp.billing_owner || '',
    purchaseCategory: organizeApp.purchase_category || '',
    optOutDate: organizeApp.opt_out_date || '',
    optOutPeriod: organizeApp.opt_out_period,
    vendorContractStatus: organizeApp.vendor_contract_status || '',
    paymentMethod: organizeApp.payment_method || '',
    paymentTerms: organizeApp.payment_terms || '',
    budgetSource: organizeApp.budget_source || '',
  }
}

// Convert App to OrganizeApp for API calls
export function appToOrganizeApp(app: App, orgId: string): Partial<OrganizeApp> {
  return {
    id: app.id,
    name: app.name,
    department: app.department || null,
    licenses_used: app.licensesUsed,
    technical_owner: app.technicalOwner || null,
    comment: app.comment || null,
    sso_enforced: app.ssoEnforced || null,
    managed_status: app.managedStatus,
    org_id: orgId,
    stitchflow_status: app.stitchflowStatus || null,
    app_tier: app.appTier || null,
    deprovisioning: app.deprovisioning || null,
    billing_frequency: app.billingFrequency || null,
    plan_limit: app.planLimit || null,
    plan_reference: app.planReference || null,
    cost_per_user: app.costPerUser || null,
    renewal_date: app.renewalDate || null,
    contract_url: app.contractUrl || null,
    vendor_files: app.vendorFiles || null,
    vendor_files_limit: app.vendorFiles ? app.vendorFiles.length : 0,
    usage_description: app.usageDescription || null,
    // New fields
    renewal_type: app.renewalType || null,
    billing_owner: app.billingOwner || null,
    purchase_category: app.purchaseCategory || null,
    opt_out_date: app.optOutDate || null,
    opt_out_period: app.optOutPeriod || null,
    vendor_contract_status: app.vendorContractStatus || null,
    payment_method: app.paymentMethod || null,
    payment_terms: app.paymentTerms || null,
    budget_source: app.budgetSource || null,
  }
}