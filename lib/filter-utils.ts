import type { App } from "@/types/app"
import type { FilterCondition } from "@/components/app-filters"
import { getLicenseUtilizationStatus } from "@/lib/utils"

// Field configuration for filter logic
const FILTER_FIELDS = [
  { value: 'name', label: 'App Name', type: 'text' },
  { value: 'department', label: 'Department', type: 'text' },
  { value: 'technicalOwner', label: 'Technical Owner', type: 'text' },
  { value: 'ssoEnforced', label: 'SSO Enforced', type: 'select', options: ['Yes', 'No'] },
  { value: 'deprovisioning', label: 'Deprovisioning', type: 'select', options: ['Okta SCIM', 'Azure AD federation', 'OneLogin SCIM', 'JumpCloud federation', 'Google federation', 'Workflow', 'Manual', 'Unknown'] },
  { value: 'managedStatus', label: 'Managed Status', type: 'select', options: ['Managed', 'Unmanaged', 'Newly discovered'] },
  { value: 'stitchflowStatus', label: 'Stitchflow Status', type: 'select', options: ['Yes - API', 'Yes - CSV Sync', 'Not connected'] },
  { value: 'appTier', label: 'App Tier', type: 'select', options: ['Tier 1', 'Tier 2', 'Tier 3'] },
  { value: 'billingFrequency', label: 'Billing Frequency', type: 'select', options: ['Annual Plan', 'Monthly Plan', 'Quarterly', 'Usage Based', 'Other'] },
  { value: 'renewalType', label: 'Renewal Type', type: 'select', options: ['Auto Renewal', 'Manual Renewal', 'Perpetual Renewal'] },
  { value: 'billingOwner', label: 'Billing Owner', type: 'text' },
  { value: 'purchaseCategory', label: 'Purchase Category', type: 'select', options: ['Software', 'Services','Add-on','Infrastructure','Hardware','Others'] },
  { value: 'optOutDate', label: 'Opt-Out Date', type: 'date' },
  { value: 'optOutPeriod', label: 'Opt-Out Period (Days)', type: 'number' },
  { value: 'vendorContractStatus', label: 'Vendor/Contract Status', type: 'select', options: ['Active', 'Inactive'] },
  { value: 'paymentMethod', label: 'Payment Method', type: 'select', options: ['Company Credit Card', 'E-Check', 'Wire', 'Accounts Payable'] },
  { value: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['Net 30', 'Due Upon Receipt', '2/10 Net 30', 'Partial Payment'] },
  { value: 'budgetSource', label: 'Budget Source', type: 'text' },
  { value: 'planLimit', label: 'Plan Limit', type: 'number' },
  { value: 'licensesUsed', label: 'Licenses Used', type: 'number' },
  { value: 'costPerUser', label: 'Cost Per User', type: 'number' },
  { value: 'renewalDate', label: 'Renewal Date', type: 'date' },
  { value: 'comment', label: 'Access Policy & Notes', type: 'limited_text' },
  { value: 'usageDescription', label: "App Usage", type: 'limited_text' },
  { value: 'vendorFileLabels', label: 'Vendor File Label', type: 'limited_text' }
]

// Helper function to get field configuration
const getFieldConfig = (fieldValue: string) => {
  return FILTER_FIELDS.find(f => f.value === fieldValue)
}

// Helper function to parse date strings, including month-only
const parseDateString = (dateString: string): Date | null => {
  if (!dateString || dateString === '—' || dateString === "Not specified") return null

  // Try parsing as a full date first - treat as local date to avoid timezone issues
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // For YYYY-MM-DD format, parse as local date
    const [year, month, day] = dateString.split('-').map(Number)
    return new Date(year, month - 1, day) // month is 0-indexed
  }

  const fullDate = new Date(dateString)
  if (!isNaN(fullDate.getTime())) {
    return fullDate
  }

  // If that fails, try parsing as a month name
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
  const monthIndex = monthNames.findIndex(m => m.startsWith(dateString.toLowerCase()))

  if (monthIndex !== -1) {
    const today = new Date()
    let year = today.getFullYear()
    const monthDate = new Date(year, monthIndex, 1)

    // If the month has already passed this year, use next year
    if (monthDate < today) {
      year += 1
    }
    return new Date(year, monthIndex, 1)
  }

  return null // Return null if parsing fails
}

// Helper function to calculate days until renewal (same logic as in app-table.tsx)
const getDaysUntilRenewal = (renewalDate: string): number => {
  const renewal = parseDateString(renewalDate)
  if (!renewal) return 0

  try {
    const today = new Date()
    
    // Reset time to start of day for accurate day calculation
    today.setHours(0, 0, 0, 0)
    renewal.setHours(0, 0, 0, 0)
    
    const diffTime = renewal.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    return diffDays
  } catch {
    return 0
  }
}

// Helper function to get renewal status text (same logic as in app-table.tsx)
const getRenewalStatus = (renewalDate: string): string => {
  if (!renewalDate) return ''
  
  const daysUntil = getDaysUntilRenewal(renewalDate)
  
  if (daysUntil < 0) return "Overdue"
  if (daysUntil <= 30) return "Due soon" 
  if (daysUntil <= 90) return "Upcoming"
  return "On Track"
}

export function applyFilters(apps: App[], filters: FilterCondition[], searchQuery: string = ''): App[] {
  return apps.filter(app => {
    // First apply search query if present
    const matchesSearch = !searchQuery.trim() || (
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.identityProvider?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.emailProvider?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.owner?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.ssoEnforced?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.deprovisioning?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.managedStatus?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.stitchflowStatus?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.appTier?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.comment?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.appPlan?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.planLimit?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.licensesUsed !== null ? app.licensesUsed.toString() : '').includes(searchQuery.toLowerCase()) ||
      app.costPerUser?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.renewalDate?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.contractUrl?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.usageDescription?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      // Vendor file labels search
      (app.vendorFiles || []).some(file => file.label?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      // License utilization status search
      (() => {
        const utilizationStatus = getLicenseUtilizationStatus(app.licensesUsed, app.planLimit || '');
        return utilizationStatus ? utilizationStatus.status.toLowerCase().includes(searchQuery.toLowerCase()) : false;
      })() ||
      // Renewal status search
      (() => {
        const renewalStatus = getRenewalStatus(app.renewalDate || '');
        return renewalStatus.toLowerCase().includes(searchQuery.toLowerCase());
      })()
    )

    if (!matchesSearch) return false

    // If no filters, return apps that match search
    if (filters.length === 0) return true

    // Apply filter conditions
    return evaluateFilterGroup(app, filters)
  })
}

function evaluateFilterGroup(app: App, filters: FilterCondition[]): boolean {
  if (filters.length === 0) return true

  let result = evaluateFilterCondition(app, filters[0])

  for (let i = 1; i < filters.length; i++) {
    const filter = filters[i]
    const conditionResult = evaluateFilterCondition(app, filter)

    if (filter.connector === 'AND') {
      result = result && conditionResult
    } else if (filter.connector === 'OR') {
      result = result || conditionResult
    }
  }

  return result
}

function evaluateFilterCondition(app: App, filter: FilterCondition): boolean {
  if (!filter.value.trim()) return true // Empty filters don't exclude

  const appValue = getAppFieldValue(app, filter.field)
  
  switch (filter.operator) {
    case 'contains':
      return appValue.toLowerCase().includes(filter.value.toLowerCase())
    
    case 'is':
      return appValue.toLowerCase() === filter.value.toLowerCase()
    
    case 'is_not':
      // For limited_text fields, this acts as "doesn't contain"
      // For other fields, this acts as exact "is not" match
      const fieldConfig = getFieldConfig(filter.field)
      if (fieldConfig?.type === 'limited_text') {
        return !appValue.toLowerCase().includes(filter.value.toLowerCase())
      }
      return appValue.toLowerCase() !== filter.value.toLowerCase()
    
    case 'starts_with':
      return appValue.toLowerCase().startsWith(filter.value.toLowerCase())
    
    case 'ends_with':
      return appValue.toLowerCase().endsWith(filter.value.toLowerCase())
    
    case 'greater_than':
      return parseFloat(appValue) > parseFloat(filter.value)
    
    case 'less_than':
      return parseFloat(appValue) < parseFloat(filter.value)
    
    case 'is_before':
    case 'is_after':
    case 'is_on_or_before':
    case 'is_on_or_after': {
      const appDate = parseDateString(appValue)
      const filterDate = parseDateString(filter.value)
      if (!appDate || !filterDate) return false

      switch (filter.operator) {
        case 'is_before': return appDate < filterDate
        case 'is_after': return appDate > filterDate
        case 'is_on_or_before': return appDate <= filterDate
        case 'is_on_or_after': return appDate >= filterDate
      }
      break
    }
    
    case 'between':
    case 'is_between':
      if (!filter.valueEnd) return true // Need both values for between
      if (filter.field === 'renewalDate') {
        const appDate = parseDateString(appValue)
        const startDate = parseDateString(filter.value)
        const endDate = parseDateString(filter.valueEnd)
        if (!appDate || !startDate || !endDate) return false
        return appDate >= startDate && appDate <= endDate
      } else {
        // For numeric fields
        const appNum = parseFloat(appValue)
        const startNum = parseFloat(filter.value)
        const endNum = parseFloat(filter.valueEnd)
        return appNum >= startNum && appNum <= endNum
      }
    
    default:
      return true
  }
}

function getAppFieldValue(app: App, field: string): string {
  switch (field) {
    case 'name': return app.name || ''
    case 'identityProvider': return app.identityProvider || ''
    case 'emailProvider': return app.emailProvider || ''
    case 'department': return app.department || ''
    case 'owner': return app.owner || ''
    case 'ssoEnforced': return app.ssoEnforced || ''
    case 'deprovisioning': return app.deprovisioning || ''
    case 'managedStatus': return app.managedStatus || ''
    case 'stitchflowStatus': return app.stitchflowStatus || ''
    case 'appTier': return app.appTier || ''
    case 'appPlan': return app.appPlan || ''
    case 'planLimit': return extractNumericValue(app.planLimit || '')
    case 'licensesUsed': return app.licensesUsed !== null ? app.licensesUsed.toString() : '0'
    case 'costPerUser': return (app.costPerUser || '').replace('$', '')
    case 'renewalDate': return app.renewalDate || ''
    case 'comment': return app.comment || ''
    case 'contractUrl': return app.contractUrl || ''
    case 'usageDescription': return app.usageDescription || ''
    case 'vendorFileLabels': return (app.vendorFiles || []).map(file => file.label).filter(label => label.trim()).join(' ')
    default: return ''
  }
}

// Helper function to extract numeric value from plan limit text
function extractNumericValue(planLimit: string): string {
  // Handle special cases
  if (!planLimit || planLimit.toLowerCase().includes('unlimited') || planLimit.toLowerCase().includes('no limit')) {
    return '999999999' // Treat unlimited as very high number for filtering
  }
  
  // Extract first number from the string
  const match = planLimit.match(/\d+/)
  return match ? match[0] : '0'
} 