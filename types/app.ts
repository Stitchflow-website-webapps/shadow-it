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

// Type for individual SKU metadata
export interface AppSKU {
  id: string
  name: string
  planLimit: string
  licensesUsed: number | null
  planReference: string
  costPerUser: string
  isDefault: boolean
  overrideContractFields: boolean
  // Contract override fields (only used when overrideContractFields is true)
  renewalDate?: string | null
  renewalType?: string | null
  billingFrequency?: string | null
  createdAt: string
  updatedAt: string
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
  technicalOwner: string
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
  // New fields
  renewalType?: string
  billingOwner?: string
  purchaseCategory?: string
  optOutDate?: string
  optOutPeriod?: number | null
  vendorContractStatus?: string
  paymentMethod?: string
  paymentTerms?: string
  budgetSource?: string
  billingFrequency?: string
  // Multi-SKU fields
  isMultiSKUEnabled?: boolean
  skus?: AppSKU[]
}
