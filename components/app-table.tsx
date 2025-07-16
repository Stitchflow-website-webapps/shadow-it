"use client"

import { useState } from "react"
import { ChevronUp, ChevronDown, Eye, Edit, ArrowUpDown, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import type { App } from "@/types/app"
import { formatCurrency, getLicenseUtilizationStatus } from "@/lib/utils"


interface AppTableProps {
  apps: App[]
  onViewApp: (app: App) => void
  onEditApp: (app: App) => void
  onRemoveApp: (appId: string) => void
  newAppIds?: Set<string>
}

type SortField = 'name' | 'renewalDate' | 'deprovisioning' | 'managedStatus' | 'stitchflowStatus' | 'appTier' | 'appPlan' | 'planLimit' | 'licensesUsed' | 'costPerUser'
type SortDirection = 'asc' | 'desc'

// Helper function to parse date strings, including month-only
const parseDateString = (dateString: string): Date | null => {
  if (!dateString || dateString === '—' || dateString === "Not specified") return null

  // Try parsing as a full date first
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

// Helper function to calculate days until renewal
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

export function AppTable({ apps, onViewApp, onEditApp, onRemoveApp, newAppIds = new Set() }: AppTableProps) {
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Debug logging
  console.log('AppTable - newAppIds:', Array.from(newAppIds))
  console.log('AppTable - app IDs:', apps.map(app => app.id))

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const sortedApps = [...apps].sort((a, b) => {
    // Handle numeric fields separately for proper numeric sorting
    if (sortField === 'planLimit') {
      const getPlanLimitValue = (limit: string) => {
        if (!limit || limit === '—') return 0
        if (limit.toLowerCase().includes('unlimited')) return Number.MAX_SAFE_INTEGER
        const numValue = parseFloat(limit.replace(/[^0-9.]/g, ''))
        return isNaN(numValue) ? 0 : numValue
      }
      const aLimitNum = getPlanLimitValue(a.planLimit || '')
      const bLimitNum = getPlanLimitValue(b.planLimit || '')
      
      if (aLimitNum < bLimitNum) return sortDirection === 'asc' ? -1 : 1
      if (aLimitNum > bLimitNum) return sortDirection === 'asc' ? 1 : -1
      return 0
    }

    if (sortField === 'licensesUsed') {
      const aNum = a.licensesUsed ?? 0
      const bNum = b.licensesUsed ?? 0
      
      if (aNum < bNum) return sortDirection === 'asc' ? -1 : 1
      if (aNum > bNum) return sortDirection === 'asc' ? 1 : -1
      return 0
    }

    if (sortField === 'costPerUser') {
      const aNum = parseFloat((a.costPerUser || '0').replace(/[^0-9.]/g, '')) || 0
      const bNum = parseFloat((b.costPerUser || '0').replace(/[^0-9.]/g, '')) || 0
      
      if (aNum < bNum) return sortDirection === 'asc' ? -1 : 1
      if (aNum > bNum) return sortDirection === 'asc' ? 1 : -1
      return 0
    }

    // Handle string and date fields
    let aValue: string | Date = ''
    let bValue: string | Date = ''

    switch (sortField) {
      case 'name':
        aValue = a.name.toLowerCase()
        bValue = b.name.toLowerCase()
        break
      case 'renewalDate':
        aValue = parseDateString(a.renewalDate || '') || new Date(0)
        bValue = parseDateString(b.renewalDate || '') || new Date(0)
        break
              case 'deprovisioning':
          aValue = a.deprovisioning || ''
          bValue = b.deprovisioning || ''
        break
      case 'stitchflowStatus':
        aValue = a.stitchflowStatus || ''
        bValue = b.stitchflowStatus || ''
        break
      case 'appTier':
        aValue = a.appTier || ''
        bValue = b.appTier || ''
        break
      case 'appPlan':
        aValue = a.appPlan || ''
        bValue = b.appPlan || ''
        break
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "—"
    
    const parsedDate = parseDateString(dateString)
    if (!parsedDate) return dateString // Show original string if it can't be parsed

    // Check if the original string was just a month
    const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
    const isMonthOnly = monthNames.some(m => m.startsWith(dateString.toLowerCase()))

    if (isMonthOnly) {
      return format(parsedDate, "MMMM") // Display only the month name
    }
    
    return format(parsedDate, "MMM dd, yyyy") // Full date format
  }

  const getStitchflowBadge = (status: string) => {
    const isConnected = status === "Yes - API" || status === "Yes - CSV Sync"
    
    const text = 
      status === "Yes - API" ? "API" :
      status === "Yes - CSV Sync" ? "CSV" :
      status === "Not connected" ? "NOT CONNECTED" :
      // Legacy support for old values
      status === "Yes - CSV Sync" ? "CSV" :
      status === "No" ? "NO" :
      "NOT SET"

    return (
      <Badge 
        variant={isConnected ? "default" : "outline"}
        className={cn(
          "text-xs font-medium",
          isConnected 
            ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200" 
            : "bg-gray-100 text-gray-600 border-gray-200"
        )}
      >
        {text}
      </Badge>
    )
  }

  const getDeprovisioningDisplay = (app: App) => {
    // Legacy support for existing values
    if (app.deprovisioning === "IdP SCIM") {
      return "IdP SCIM"
    }
    
    return app.deprovisioning || "—"
  }

  const SortableHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th 
      className={cn("px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 select-none transition-colors", className)}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field ? (
          sortDirection === 'asc' ? 
            <ChevronUp className="h-4 w-4 text-gray-700" /> : 
            <ChevronDown className="h-4 w-4 text-gray-700" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />
        )}
      </div>
    </th>
  )

  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader field="name" className="w-[16%]">App Name</SortableHeader>
              <SortableHeader field="deprovisioning" className="w-[10%]">Deprovisioning</SortableHeader>
              <SortableHeader field="appTier" className="w-[8%]">Tier</SortableHeader>
              <SortableHeader field="appPlan" className="w-[10%]">Plan</SortableHeader>
              <SortableHeader field="planLimit" className="w-[9%]">Limit</SortableHeader>
              <SortableHeader field="licensesUsed" className="w-[11%]">Licenses Used</SortableHeader>
              <SortableHeader field="costPerUser" className="w-[8%]">Cost/User</SortableHeader>
              <SortableHeader field="renewalDate" className="w-[15%]">Renewal</SortableHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[13%]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedApps.map((app) => (
              <tr 
                key={app.id} 
                className={cn(
                  "hover:bg-gray-50 cursor-pointer transition-colors",
                  newAppIds.has(app.id) && "border-2 border-orange-300"
                )}
                style={newAppIds.has(app.id) ? { backgroundColor: "#FFF8EB" } : {}}
                onClick={() => onViewApp(app)}
              >
                <td className="px-4 py-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {app.name}
                      {newAppIds.has(app.id) && <span className="ml-2 text-orange-600 font-bold">[NEW]</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStitchflowBadge(app.stitchflowStatus || '')}
                      {app.department && (
                        <div className={cn(
                          "text-xs text-gray-500 truncate",
                          app.stitchflowStatus === "Not connected" ? "max-w-16" : "max-w-24"
                        )}>• {app.department}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 truncate">
                    {getDeprovisioningDisplay(app)}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 truncate">{app.appTier || "—"}</span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 truncate">{app.appPlan || "—"}</span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 truncate">{app.planLimit || "—"}</span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {app.licensesUsed !== null ? app.licensesUsed.toString() : "—"}
                  </div>
                  {(() => {
                    const utilizationStatus = getLicenseUtilizationStatus(app.licensesUsed, app.planLimit || '');
                    return utilizationStatus ? (
                      <div className="flex items-center gap-1 mt-1">
                        <div className={cn(
                          "w-1 h-1 rounded-full",
                          utilizationStatus.status === 'Exceeded limit' ? "bg-red-500" :
                          utilizationStatus.status === 'Near capacity' ? "bg-orange-500" :
                          utilizationStatus.status === 'Growing usage' ? "bg-yellow-500" :
                          "bg-emerald-500"
                        )} />
                        <span className="text-xs text-gray-500">
                          {utilizationStatus.status}
                        </span>
                      </div>
                    ) : null;
                  })()}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className="text-sm text-gray-900 font-medium">
                    {formatCurrency(app.costPerUser)}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <div className="space-y-1">
                    <span className="text-sm text-gray-900 block truncate">{formatDate(app.renewalDate)}</span>
                    {app.renewalDate && (() => {
                      const daysUntil = getDaysUntilRenewal(app.renewalDate)
                      return (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs font-medium rounded-full px-1.5 py-0.5 border flex items-center gap-1 w-fit",
                            daysUntil < 0
                              ? "bg-red-50 text-red-700 border-red-200"
                              : daysUntil <= 30
                              ? "bg-red-50 text-red-700 border-red-200"
                              : daysUntil <= 90
                              ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          )}
                        >
                          <div className={cn(
                            "w-1 h-1 rounded-full",
                            daysUntil < 0 || daysUntil <= 30 
                              ? "bg-red-500 animate-pulse" 
                              : daysUntil <= 90 
                              ? "bg-yellow-500" 
                              : "bg-emerald-500"
                          )} />
                          <span className="font-semibold text-xs">
                            {daysUntil < 0 ? "Overdue" : daysUntil <= 30 ? "Due soon" : daysUntil <= 90 ? "Upcoming" : "On Track"}
                          </span>
                          <span className="font-normal opacity-80 text-xs">
                            {daysUntil < 0 ? `${Math.abs(daysUntil)}d` : `${daysUntil}d`}
                          </span>
                        </Badge>
                      )
                    })()}
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewApp(app)}
                      className="text-gray-600 hover:text-gray-900 h-8 w-8 p-0"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditApp(app)}
                      className="text-gray-600 hover:text-gray-900 h-8 w-8 p-0"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-red-600 h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-h4 text-primary-text font-semibold">Remove App</AlertDialogTitle>
                          <AlertDialogDescription className="text-body text-secondary-text">
                            Are you sure you want to remove "{app.name}" from your App List? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-gray-200 text-secondary-text hover:bg-gray-50 font-medium">Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onRemoveApp(app.id)} className="bg-bg-dark hover:bg-bg-dark/90 text-white font-medium">
                            Remove App
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {apps.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No apps found</p>
        </div>
      )}
    </div>
  )
} 