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
  vendorFiles?: VendorFile[]
  vendorFilesLimit?: number // Count of uploaded vendor files (not the maximum allowed)
  licensesUsed: number | null
  usageDescription?: string
}
