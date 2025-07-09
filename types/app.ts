export interface App {
  id: string
  name: string
  identityProvider: string
  emailProvider: string
  ssoEnforced: string
  deprovisioning: string
  managedStatus: string
  stitchflowStatus: string
  appTier: string
  department: string
  owner: string
  comment?: string
  appPlan: string
  planLimit: string
  planReference: string
  costPerUser?: string
  renewalDate?: string
  contractUrl?: string
  licensesUsed: number | null
  usageDescription?: string
}
