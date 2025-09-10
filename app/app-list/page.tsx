"use client"

import { useState, useEffect, useMemo } from "react"
import { Plus, Settings, Search, X, ChevronLeft, ChevronRight, KeyRound, Users, Link, CreditCard, FileText, Trash2, Edit2, Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AppTable } from "@/components/app-table"
import { EmptyState } from "@/components/empty-state"
import { AppFilters, type FilterCondition } from "@/components/app-filters"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { EditableCard } from "@/components/editable-card"
import { organizeApi } from "@/lib/organize-api"
import { applyFilters } from "@/lib/filter-utils"
import { organizeAppToApp, appToOrganizeApp } from "@/lib/organize-type-adapter"
import { useAppIntegrations, type AppIntegration } from "@/hooks/use-app-integrations"
import { cn } from "@/lib/utils"
import type { OrganizeApp } from "@/lib/supabase/organize-client"
import type { App, VendorFile } from "@/types/app"
import Sidebar from "@/app/components/Sidebar"

// Local organization settings interface
interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

// User info interface
interface UserInfo {
  name: string;
  email: string;
  avatar_url: string | null;
}

// Combined user info for upload functionality
interface UserInfoWithOrg {
  orgId: string;
}



// Simple add apps dialog that doesn't use useAuth
function SimpleAddAppsDialog({ open, onOpenChange, onAddApps, existingApps, orgSettings }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddApps: (apps: App[]) => void
  existingApps: App[]
  orgSettings: OrganizationSettings | null
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set())
  const [customApps, setCustomApps] = useState<AppIntegration[]>([])
  const { integrations, loading } = useAppIntegrations()

  // Normalize app name for comparison (lowercase and remove spaces)
  const normalizeAppName = (name: string) => {
    return name.toLowerCase().replace(/\s+/g, '')
  }

  // Get normalized names of existing apps
  const existingAppNames = useMemo(() => {
    return new Set(existingApps.map(app => normalizeAppName(app.name)))
  }, [existingApps])

  // Combine integrations with custom apps, but filter out existing apps
  const allApps = useMemo(() => {
    const combinedApps = [...integrations, ...customApps]
    return combinedApps.filter(app => !existingAppNames.has(normalizeAppName(app.name)))
  }, [integrations, customApps, existingAppNames])

  // Filter apps based on search query
  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return allApps
    return allApps.filter((app) => app.name.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [allApps, searchQuery])

  // Check if search query matches any existing app (including already added ones)
  const hasExactMatch = useMemo(() => {
    return allApps.some((app) => normalizeAppName(app.name) === normalizeAppName(searchQuery)) ||
           existingAppNames.has(normalizeAppName(searchQuery.trim()))
  }, [allApps, searchQuery, existingAppNames])

  const handleToggleApp = (appName: string) => {
    const newSelected = new Set(selectedApps)
    if (newSelected.has(appName)) {
      newSelected.delete(appName)
    } else {
      newSelected.add(appName)
    }
    setSelectedApps(newSelected)
  }

  const handleAddCustomApp = () => {
    if (!searchQuery.trim() || hasExactMatch) return

    const customApp: AppIntegration = {
      name: searchQuery.trim(),
      connectionStatus: "Yes - CSV Sync",
    }

    setCustomApps([...customApps, customApp])
    setSelectedApps(new Set([...Array.from(selectedApps), customApp.name]))
    setSearchQuery("")
  }

  const handleRemoveCustomApp = (appName: string) => {
    setCustomApps(customApps.filter((app) => app.name !== appName))
    const newSelected = new Set(selectedApps)
    newSelected.delete(appName)
    setSelectedApps(newSelected)
  }

  const handleAddApps = () => {
    const appsToAdd: App[] = Array.from(selectedApps).map((appName) => {
      const appData = allApps.find((app) => app.name === appName)
      return {
        id: crypto.randomUUID(),
        name: appName,
        identityProvider: orgSettings?.identityProvider || "",
        emailProvider: orgSettings?.emailProvider || "",
        ssoEnforced: "",
        deprovisioning: "",
        managedStatus: "",
        stitchflowStatus: appData?.connectionStatus || "Yes - CSV Sync",
        appTier: "",
        department: "",
        technicalOwner: "",
        comment: "",
        billingFrequency: "",
        planLimit: "",
        planReference: "",
        costPerUser: "",
        renewalDate: "",
        contractUrl: "",
        licensesUsed: null,
        vendorFiles: [],
        vendorFilesLimit: 0
        usageDescription: "",
        // New fields
        renewalType: "",
        billingOwner: "",
        purchaseCategory: "",
        optOutDate: "",
        optOutPeriod: null,
        vendorContractStatus: "",
        paymentMethod: "",
        paymentTerms: "",
        budgetSource: "",
        vendorFiles: [],
        vendorFilesLimit: 0
      }
    })

    onAddApps(appsToAdd)

    // Reset state
    setSelectedApps(new Set())
    setCustomApps([])
    setSearchQuery("")
  }

  const handleClose = () => {
    setSelectedApps(new Set())
    setCustomApps([])
    setSearchQuery("")
    onOpenChange(false)
  }

  if (loading) { 
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl h-[600px]">
          <DialogHeader>
            <DialogTitle>Add Apps</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading apps...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Apps</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search for apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selected Apps Count */}
        {selectedApps.size > 0 && (
          <div className="text-sm text-muted-foreground">
            {selectedApps.size} app{selectedApps.size !== 1 ? "s" : ""} selected
          </div>
        )}

        {/* Apps List */}
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-2">
            {/* Add Custom App Option */}
            {searchQuery.trim() && !hasExactMatch && (
              <div className="flex items-center justify-between p-3 border border-dashed border-muted-foreground rounded-lg">
                <div className="flex items-center gap-3">
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Add "{searchQuery}"</p>
                    <p className="text-xs text-muted-foreground">Custom app</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={handleAddCustomApp}>
                  Add
                </Button>
              </div>
            )}

            {/* Available Apps */}
            {[...filteredApps]
              .sort((a, b) => {
                const aSelected = selectedApps.has(a.name)
                const bSelected = selectedApps.has(b.name)
                if (aSelected && !bSelected) return -1
                if (!aSelected && bSelected) return 1
                return 0
              })
              .map((app) => {
                const isSelected = selectedApps.has(app.name)
                const isCustom = customApps.some((customApp) => customApp.name === app.name)

                return (
                  <div
                    key={app.name}
                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => handleToggleApp(app.name)}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox checked={isSelected} onChange={() => handleToggleApp(app.name)} />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{app.name}</p>
                          {isCustom && (
                            <Badge variant="outline" className="text-xs">
                              Custom
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{app.connectionStatus}</p>
                      </div>
                    </div>
                    {isCustom && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveCustomApp(app.name)
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )
              })}

            {/* No Results */}
            {filteredApps.length === 0 && searchQuery.trim() && hasExactMatch && (
              <div className="text-center py-8 text-muted-foreground">
                {existingAppNames.has(normalizeAppName(searchQuery.trim())) ? (
                  <p>"{searchQuery}" is already in your app list</p>
                ) : (
                  <p>No additional apps found for "{searchQuery}"</p>
                )}
              </div>
            )}

            {filteredApps.length === 0 && !searchQuery.trim() && (
              <div className="text-center py-8 text-muted-foreground">
                <p>Start typing to search for apps</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAddApps} disabled={selectedApps.size === 0}>
            Add {selectedApps.size > 0 ? `${selectedApps.size} ` : ""}App{selectedApps.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Simple app detail component that doesn't use useAuth
function SimpleAppDetail({ app, onUpdateApp, onRemoveApp, initialEditMode = false, organization, userInfo }: {
  app: App
  onUpdateApp: (app: App) => void
  onRemoveApp: (appId: string) => void
  initialEditMode?: boolean
  organization: OrganizationSettings | null
  userInfo?: UserInfoWithOrg | null
}) {
  const [isEditMode, setIsEditMode] = useState(initialEditMode)
  const [editedFields, setEditedFields] = useState<Partial<App>>({})
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [vendorFiles, setVendorFiles] = useState<VendorFile[]>(app.vendorFiles || [])

  // Reset edit mode when app changes
  useEffect(() => {
    setIsEditMode(initialEditMode)
    setEditedFields({})
    setVendorFiles(app.vendorFiles || [])
  }, [app.id, initialEditMode])

  const handleEdit = () => {
    setIsEditMode(true)
    setEditedFields({})
  }

  const handleCancel = () => {
    setIsEditMode(false)
    setEditedFields({})
  }

  const handleSave = () => {
    const updatedApp = { ...app, ...editedFields, vendorFiles }
    onUpdateApp(updatedApp)
    setIsEditMode(false)
    setEditedFields({})
  }

  const handleVendorFilesChange = (files: VendorFile[]) => {
    setVendorFiles(files)
    // Update the vendorFilesLimit field to reflect the current count
    handleFieldChange({ vendorFilesLimit: files.length })
  }

  const handleRemove = () => {
    onRemoveApp(app.id)
    setShowRemoveDialog(false)
  }

  const handleFieldChange = (fields: Partial<App>) => {
    // Handle numeric conversion for licensesUsed
    const processedFields = { ...fields }
    if ('licensesUsed' in processedFields && typeof processedFields.licensesUsed === 'string') {
      const numValue = processedFields.licensesUsed === '' ? null : parseInt(processedFields.licensesUsed, 10)
      processedFields.licensesUsed = isNaN(numValue as number) ? null : numValue
    }
    setEditedFields((prev) => ({ ...prev, ...processedFields }))
  }

  const getDeprovisioningOptions = () => {
    const idp = organization?.identityProvider

    const baseOptions = [
      { value: "Workflow", label: "Workflow" },
      { value: "Manual", label: "Manual" },
      { value: "Unknown", label: "Unknown" },
    ]

    // If no org IDP is set, return only base options
    if (!idp) {
      return baseOptions
    }

    let idpSpecificOptions: { value: string; label: string }[] = []

    switch (idp) {
      case "Okta":
        idpSpecificOptions = [{ value: "Okta SCIM", label: "Okta SCIM" }]
        break
      case "Entra ID/Azure AD":
        idpSpecificOptions = [{ value: "Azure AD federation", label: "Azure AD federation" }]
        break
      case "Onelogin":
        idpSpecificOptions = [{ value: "OneLogin SCIM", label: "OneLogin SCIM" }]
        break
      case "JumpCloud":
        idpSpecificOptions = [{ value: "JumpCloud federation", label: "JumpCloud federation" }]
        break
      case "Google Workspace":
        idpSpecificOptions = [{ value: "Google federation", label: "Google federation" }]
        break
    }

    return [...idpSpecificOptions, ...baseOptions]
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary-text">{app.name}</h2>
          <p className="text-sm text-gray-500 mt-1">{editedFields.billingFrequency ?? (app.billingFrequency || "—")}</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Check className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
              
              <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 bg-white">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove App</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to remove "{app.name}"? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleRemove}
                      className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
                    >
                      Remove App
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      {/* Card Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Authentication Card */}
          <EditableCard
            title="Authentication"
            icon={<KeyRound className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={handleFieldChange}
            appName={app.name}
            userInfo={userInfo}
            fields={[
              {
                label: "SSO ENFORCED?",
                value: editedFields.ssoEnforced ?? (app.ssoEnforced || ""),
                field: "ssoEnforced",
                type: "select",
                placeholder: "Select SSO status",
                options: [
                  { value: "Yes", label: "Yes" },
                  { value: "No", label: "No" },
                ],
              },
              {
                label: "DEPROVISIONING",
                value: editedFields.deprovisioning ?? (app.deprovisioning || ""),
                field: "deprovisioning",
                type: "select",
                placeholder: "Select deprovisioning method",
                options: getDeprovisioningOptions(),
                disabled: !organization?.identityProvider,
                disabledText: "Please update your IdP settings to edit this field",
              },
            ]}
          />

          {/* App Usage & Ownership Card */}
          <EditableCard
            title="App Usage & Ownership"
            icon={<Users className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={(updates) => handleFieldChange(updates)}
            appName={app.name}
            userInfo={userInfo}
            fields={[
              {
                label: "DEPARTMENT",
                value: editedFields.department ?? (app.department || ""),
                field: "department",
                type: "input",
                placeholder: "Enter department",
              },
              {
                label: "OWNER",
                value: editedFields.owner ?? (app.owner || ""),
                field: "owner",
                type: "input",
                placeholder: "Enter owner name",
              },
              {
                label: "ACCESS POLICY & NOTES",
                value: editedFields.comment ?? (app.comment || ""),
                field: "comment",
                type: "textarea",
                placeholder: "Add access policy and notes",
              },
              {
                label: "WHAT'S THE APP USED FOR",
                value: editedFields.usageDescription ?? (app.usageDescription || ""),
                field: "usageDescription",
                type: "textarea",
                placeholder: "Enter usage description",
              },
            ]}
          />

          {/* Vendor Files & Notes Card */}
          <EditableCard
            title="Vendor Files and Notes"
            icon={<FileText className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={handleFieldChange}
            appName={app.name}
            userInfo={userInfo}
            vendorFiles={vendorFiles}
            onVendorFilesChange={handleVendorFilesChange}
            fields={[]}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* App Management Card */}
          <EditableCard
            title="App Management"
            icon={<Link className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={(updates) => handleFieldChange(updates)}
            appName={app.name}
            userInfo={userInfo}
            fields={[
              {
                label: "STITCHFLOW CONNECTION STATUS",
                value: editedFields.stitchflowStatus ?? (app.stitchflowStatus || ""),
                field: "stitchflowStatus",
                type: "select",
                placeholder: "Select connection status",
                options: [
                  { value: "Yes - API", label: "Yes - API" },
                  { value: "Yes - CSV Sync", label: "Yes - CSV Sync" },
                  { value: "Not connected", label: "Not connected" },
                ],
              },
              {
                label: "APP TIER",
                value: editedFields.appTier ?? (app.appTier || ""),
                field: "appTier",
                type: "select",
                placeholder: "Select app tier",
                options: [
                  { value: "Tier 1", label: "Tier 1" },
                  { value: "Tier 2", label: "Tier 2" },
                  { value: "Tier 3", label: "Tier 3" },
                ],
              },
              {
                label: "MANAGED STATUS",
                value: editedFields.managedStatus ?? (app.managedStatus || ""),
                field: "managedStatus",
                type: "select",
                placeholder: "Select managed status",
                options: [
                  { value: "Managed", label: "Managed" },
                  { value: "Unmanaged", label: "Unmanaged" },
                  { value: "Newly discovered", label: "Newly discovered" }
                ],
              }
            ]}
          />
        {/* App Management Card */}
        <EditableCard
          title="App Management"
          icon={<Link className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={(updates) => handleFieldChange(updates)}
          appName={app.name}
          userInfo={userInfo}
          fields={[
            {
              label: "STITCHFLOW CONNECTION STATUS",
              value: editedFields.stitchflowStatus ?? (app.stitchflowStatus || ""),
              field: "stitchflowStatus",
              type: "select",
              placeholder: "Select connection status",
              options: [
                { value: "Yes - API", label: "Yes - API" },
                { value: "Yes - CSV Sync", label: "Yes - CSV Sync" },
                { value: "Not connected", label: "Not connected" },
              ],
            },
            {
              label: "APP TIER",
              value: editedFields.appTier ?? (app.appTier || ""),
              field: "appTier",
              type: "select",
              placeholder: "Select app tier",
              options: [
                { value: "Tier 1", label: "Tier 1" },
                { value: "Tier 2", label: "Tier 2" },
                { value: "Tier 3", label: "Tier 3" },
              ],
            },
            {
              label: "MANAGED STATUS",
              value: editedFields.managedStatus ?? (app.managedStatus || ""),
              field: "managedStatus",
              type: "select",
              placeholder: "Select managed status",
              options: [
                { value: "Managed", label: "Managed" },
                { value: "Unmanaged", label: "Unmanaged" },
                { value: "Newly discovered", label: "Newly discovered" }
              ],
            }
          ]}
        />

        {/* App Usage & Ownership Card */}
        <EditableCard
          title="App Usage & Ownership"
          icon={<Users className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={(updates) => handleFieldChange(updates)}
          appName={app.name}
          userInfo={userInfo}
          fields={[
            {
              label: "DEPARTMENT",
              value: editedFields.department ?? (app.department || ""),
              field: "department",
              type: "input",
              placeholder: "Enter department",
            },
            {
              label: "TECHNICAL OWNER",
              value: editedFields.technicalOwner ?? (app.technicalOwner || ""),
              field: "technicalOwner",
              type: "input",
              placeholder: "Enter technical owner name",
            },
            {
              label: "ACCESS POLICY & NOTES",
              value: editedFields.comment ?? (app.comment || ""),
              field: "comment",
              type: "textarea",
              placeholder: "Add access policy and notes",
            },
            {
              label: "WHAT'S THE APP USED FOR",
              value: editedFields.usageDescription ?? (app.usageDescription || ""),
              field: "usageDescription",
              type: "textarea",
              placeholder: "Enter usage description",
            },
          ]}
        />
          {/* App Usage & Ownership Card */}
          <EditableCard
            title="App Usage & Ownership"
            icon={<Users className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={(updates) => handleFieldChange(updates)}
            appName={app.name}
            userInfo={userInfo}
            fields={[
              {
                label: "DEPARTMENT",
                value: editedFields.department ?? (app.department || ""),
                field: "department",
                type: "input",
                placeholder: "Enter department",
              },
              {
                label: "OWNER",
                value: editedFields.owner ?? (app.owner || ""),
                field: "owner",
                type: "input",
                placeholder: "Enter owner name",
              },
              {
                label: "ACCESS POLICY & NOTES",
                value: editedFields.comment ?? (app.comment || ""),
                field: "comment",
                type: "textarea",
                placeholder: "Add access policy and notes",
              },
              {
                label: "WHAT'S THE APP USED FOR",
                value: editedFields.usageDescription ?? (app.usageDescription || ""),
                field: "usageDescription",
                type: "textarea",
                placeholder: "Enter usage description",
              },
            ]}
          />

          {/* Vendor Files & Notes Card */}
          <EditableCard
            title="Vendor Files and Notes"
            icon={<FileText className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={handleFieldChange}
            appName={app.name}
            userInfo={userInfo}
            vendorFiles={vendorFiles}
            onVendorFilesChange={handleVendorFilesChange}
            fields={[]}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* App Management Card */}
          <EditableCard
            title="App Management"
            icon={<Link className="h-5 w-5 text-primary-text" />}
            isEditing={isEditMode}
            onUpdate={(updates) => handleFieldChange(updates)}
            appName={app.name}
            userInfo={userInfo}
            fields={[
              {
                label: "STITCHFLOW CONNECTION STATUS",
                value: editedFields.stitchflowStatus ?? (app.stitchflowStatus || ""),
                field: "stitchflowStatus",
                type: "select",
                placeholder: "Select connection status",
                options: [
                  { value: "Yes - API", label: "Yes - API" },
                  { value: "Yes - CSV Sync", label: "Yes - CSV Sync" },
                  { value: "Not connected", label: "Not connected" },
                ],
              },
              {
                label: "APP TIER",
                value: editedFields.appTier ?? (app.appTier || ""),
                field: "appTier",
                type: "select",
                placeholder: "Select app tier",
                options: [
                  { value: "Tier 1", label: "Tier 1" },
                  { value: "Tier 2", label: "Tier 2" },
                  { value: "Tier 3", label: "Tier 3" },
                ],
              },
              {
                label: "MANAGED STATUS",
                value: editedFields.managedStatus ?? (app.managedStatus || ""),
                field: "managedStatus",
                type: "select",
                placeholder: "Select managed status",
                options: [
                  { value: "Managed", label: "Managed" },
                  { value: "Unmanaged", label: "Unmanaged" },
                  { value: "Newly discovered", label: "Newly discovered" }
                ],
              }
            ]}
          />

          {/* License & Renewal Card */}
        <EditableCard
          title="License & Renewal"
          icon={<CreditCard className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={(updates) => handleFieldChange(updates)}
          appName={app.name}
          userInfo={userInfo}
          fields={[
            {
              label: "BILLING FREQUENCY/CYCLE",
              value: editedFields.billingFrequency ?? (app.billingFrequency || ""),
              field: "billingFrequency",
              type: "select",
              placeholder: "Select billing frequency",
              options: [
                { value: "Annual Plan", label: "Annual Plan" },
                { value: "Monthly Plan", label: "Monthly Plan" },
                { value: "Quarterly", label: "Quarterly" },
                { value: "Usage Based", label: "Usage Based" },
                { value: "Other", label: "Other" },
              ],
            },
            {
              label: "RENEWAL TYPE",
              value: editedFields.renewalType ?? (app.renewalType || ""),
              field: "renewalType",
              type: "select",
              placeholder: "Select renewal type",
              options: [
                { value: "Auto Renewal", label: "Auto Renewal" },
                { value: "Manual Renewal", label: "Manual Renewal" },
                { value: "Perpetual Renewal", label: "Perpetual Renewal" },
              ],
            },
            {
              label: "BILLING OWNER",
              value: editedFields.billingOwner ?? (app.billingOwner || ""),
              field: "billingOwner",
              type: "input",
              placeholder: "Enter billing owner name",
            },
            {
              label: "PURCHASE CATEGORY",
              value: editedFields.purchaseCategory ?? (app.purchaseCategory || ""),
              field: "purchaseCategory",
              type: "select",
              placeholder: "Select purchase category",
              options: [
                { value: "Software", label: "Software" },
                { value: "Services", label: "Services" },
                { value: "Add-on", label: "Add-on" },
                { value: "Infrastructure", label: "Infrastructure" },
                { value: "Hardware", label: "Hardware" },
                { value: "Others", label: "Others" },
              ],
            },
            {
              label: "OPT-OUT DATE",
              value: editedFields.optOutDate ?? (app.optOutDate || ""),
              field: "optOutDate",
              type: "date",
              placeholder: "Select opt-out deadline date",
            },
            {
              label: "OPT-OUT PERIOD (DAYS)",
              value: editedFields.optOutPeriod !== undefined ? String(editedFields.optOutPeriod || "") : String(app.optOutPeriod || ""),
              field: "optOutPeriod",
              type: "input",
              placeholder: "Enter number of days for opt-out period",
            },
            {
              label: "VENDOR/CONTRACT STATUS",
              value: editedFields.vendorContractStatus ?? (app.vendorContractStatus || ""),
              field: "vendorContractStatus",
              type: "select",
              placeholder: "Select vendor/contract status",
              options: [
                { value: "Active", label: "Active" },
                { value: "Inactive", label: "Inactive" },
              ],
            },
            {
              label: "PAYMENT METHOD",
              value: editedFields.paymentMethod ?? (app.paymentMethod || ""),
              field: "paymentMethod",
              type: "select",
              placeholder: "Select payment method",
              options: [
                { value: "Company Credit Card", label: "Company Credit Card" },
                { value: "E-Check", label: "E-Check" },
                { value: "Wire", label: "Wire" },
                { value: "Accounts Payable", label: "Accounts Payable" },
              ],
            },
            {
              label: "PAYMENT TERMS",
              value: editedFields.paymentTerms ?? (app.paymentTerms || ""),
              field: "paymentTerms",
              type: "select",
              placeholder: "Select payment terms",
              options: [
                { value: "Net 30", label: "Net 30" },
                { value: "Due Upon Receipt", label: "Due Upon Receipt" },
                { value: "2/10 Net 30", label: "2/10 Net 30" },
                { value: "Partial Payment", label: "Partial Payment" },
              ],
            },
            {
              label: "BUDGET SOURCE",
              value: editedFields.budgetSource ?? (app.budgetSource || ""),
              field: "budgetSource",
              type: "input",
              placeholder: "Enter budget source (e.g., Legal, Finance, Tech)",
            },
            {
              label: "RENEWAL DATE",
              value: editedFields.renewalDate ?? (app.renewalDate || ""),
              field: "renewalDate",
              type: "date",
              placeholder: "Select renewal date",
            },
            {
              label: "PLAN LIMIT",
              value: editedFields.planLimit ?? (app.planLimit || ""),
              field: "planLimit",
              type: "input",
              placeholder: "Enter plan limit",
            },
            {
              label: "LICENSES USED",
              value: editedFields.licensesUsed !== undefined ? String(editedFields.licensesUsed || "") : String(app.licensesUsed || ""),
              field: "licensesUsed",
              type: "input",
              placeholder: "Enter number of licenses used",
            },
            {
              label: "PLAN REFERENCE",
              value: editedFields.planReference ?? (app.planReference || ""),
              field: "planReference",
              type: "input",
              placeholder: "Enter plan reference",
            },
            {
              label: "COST PER USER (PER MONTH)",
              value: editedFields.costPerUser ?? (app.costPerUser || ""),
              field: "costPerUser",
              type: "currency",
              placeholder: "Enter cost per user",
            },
            {
              label: "CONTRACT URL",
              value: editedFields.contractUrl ?? (app.contractUrl || ""),
              field: "contractUrl",
              type: "file-url",
              placeholder: "Upload contract or enter URL",
            },
          ]}
        />
        </div>
      </div>
    </div>
  )
}

// Simple app detail tray that passes organization settings to AppDetail
function SimpleAppDetailTray({
  app,
  isOpen,
  isEditMode,
  onClose,
  onUpdateApp,
  onRemoveApp,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  organization,
  shadowOrgId,
}: {
  app: App | null
  isOpen: boolean
  isEditMode: boolean
  onClose: () => void
  onUpdateApp: (app: App) => void
  onRemoveApp: (appId: string) => void
  onPrevious?: () => void
  onNext?: () => void
  hasPrevious?: boolean
  hasNext?: boolean
  organization: OrganizationSettings | null
  shadowOrgId?: string | null
}) {
  if (!app) return null

  return (
    <div
      className={cn(
        "fixed right-0 top-0 h-full bg-white border-l border-gray-200 shadow-xl transition-transform duration-300 ease-in-out z-40 overflow-hidden",
        "w-[70%] min-w-[700px] max-w-[900px]",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 shrink-0">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{app.name}</h2>
          <div className="text-sm text-gray-500 shrink-0">
            Apps › {app.name}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Navigation buttons */}
          {(onPrevious || onNext) && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onPrevious}
                disabled={!hasPrevious}
                className="text-gray-600 hover:text-gray-900 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onNext}
                disabled={!hasNext}
                className="text-gray-600 hover:text-gray-900 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-gray-300 mx-2" />
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto h-[calc(100vh-80px)] p-6">
        <SimpleAppDetail
          app={app}
          onUpdateApp={onUpdateApp}
          onRemoveApp={(appId) => {
            onRemoveApp(appId)
            onClose()
          }}
          initialEditMode={isEditMode}
          organization={organization}
          userInfo={{ orgId: shadowOrgId || '' }}
        />
      </div>
    </div>
  )
}

// Simple empty state component
function SimpleEmptyState({ onAddApp, orgSettings, onSettingsUpdate }: {
  onAddApp: () => void
  orgSettings: OrganizationSettings | null
  onSettingsUpdate: (settings: OrganizationSettings) => void
}) {
  const hasOrgSettings = orgSettings?.identityProvider && orgSettings?.emailProvider

  if (!hasOrgSettings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center p-6 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold text-gray-900">Welcome to Managed Apps</h1>
          <p className="text-lg text-gray-600">
            To get started, add your first app. You can configure your organization settings later for full functionality.
          </p>
        </div>

        <Button onClick={onAddApp} size="lg" className="text-base px-6 py-3">
            <Plus className="h-5 w-5 mr-2" />
            Add your first app
        </Button>

        <div className="w-full max-w-md">
          <div className="p-6 border-2 border-dashed border-gray-200 rounded-lg">
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Settings className="h-5 w-5" />
                <h3 className="text-lg font-medium">Organization Settings</h3>
              </div>
              
              <p className="text-sm text-gray-600">
                For enhanced features, go to Settings → IdP in the sidebar to configure your Identity and Email providers.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center p-6 space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-gray-900">Welcome to Managed Apps</h1>
        <p className="text-lg text-gray-600">
          Your organization is configured. Add your first app to get started.
        </p>
      </div>

      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-sm text-gray-700 space-y-1 text-center">
          <p><span className="font-medium">Identity Provider:</span> {orgSettings.identityProvider}</p>
          <p><span className="font-medium">Email Provider:</span> {orgSettings.emailProvider}</p>
        </div>
      </div>

      <Button onClick={onAddApp} size="lg" className="text-base px-6 py-3">
        <Plus className="h-5 w-5 mr-2" />
        Add your first app
      </Button>
    </div>
  )
}

function AppInboxContent() {
  const router = useRouter()
  const [apps, setApps] = useState<OrganizeApp[]>([])
  const [selectedApp, setSelectedApp] = useState<OrganizeApp | null>(null)
  const [isDetailTrayOpen, setIsDetailTrayOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [shadowOrgId, setShadowOrgId] = useState<string | null>(null)
  const [fullShadowOrgIds, setFullShadowOrgIds] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null)
  
  // Sidebar state management
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentView, setCurrentView] = useState('organize-app-inbox')
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)

  // New apps tracking
  const [newAppIds, setNewAppIds] = useState<Set<string>>(new Set())
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set())

  // Get shadow org ID from cookies/localStorage on component mount
  useEffect(() => {
    const orgId = document.cookie
      .split('; ')
      .find(row => row.startsWith('orgId='))
      ?.split('=')[1] || localStorage.getItem('userOrgId')
    
    const email = document.cookie
      .split('; ')
      .find(row => row.startsWith('userEmail='))
      ?.split('=')[1] || localStorage.getItem('userEmail')
    
    setShadowOrgId(orgId)
    setUserEmail(email)

    const fetchOrgSettings = async () => {
      if (!orgId) return;
      try {
        const response = await fetch(`/api/organize/organization?shadowOrgId=${orgId}`)
        if (response.ok) {
          const data = await response.json()
          const identityProvider = data.identity_provider === 'EMPTY' ? '' : data.identity_provider;
          const emailProvider = data.email_provider === 'EMPTY' ? '' : data.email_provider;
          
          const settings = { identityProvider, emailProvider };
          setOrgSettings(settings);
          localStorage.setItem(`orgSettings_${orgId}`, JSON.stringify(settings));
          
          // Store the full shadow org IDs for sync operations
          // Always try to get the full comma-separated shadow org IDs from the database
          const fullIdsResponse = await fetch(`/api/organize/organization/full-ids?shadowOrgId=${orgId}`)
          if (fullIdsResponse.ok) {
            const fullIdsData = await fullIdsResponse.json()
            console.log('Fetched full shadow org IDs:', fullIdsData.fullShadowOrgIds)
            setFullShadowOrgIds(fullIdsData.fullShadowOrgIds)
          } else {
            console.log('Failed to fetch full shadow org IDs, using single shadow org ID')
            setFullShadowOrgIds(null)
          }
        }
      } catch (error) {
        console.error('Error fetching organization settings:', error)
      }
    };
    
    fetchOrgSettings();
  }, [])

  // Load apps from database when shadowOrgId is available
  useEffect(() => {
    const loadApps = async () => {
      if (!shadowOrgId) return
      
      try {
        setIsLoading(true)
        // Use full shadow org IDs for app inbox operations if available, otherwise fall back to single shadow org ID
        const operationShadowOrgId = fullShadowOrgIds || shadowOrgId;
        console.log('Loading apps with shadow org ID:', operationShadowOrgId)
        console.log('Full shadow org IDs available:', fullShadowOrgIds)
        const appsData = await organizeApi.getApps(operationShadowOrgId)
        setApps(appsData)
        
        // Always store current app IDs for comparison
        const currentAppIds = appsData.map(app => app.id)
        localStorage.setItem(`allAppIds_${shadowOrgId}`, JSON.stringify(currentAppIds))
        
        // Load new app IDs from localStorage and clean up invalid ones
        const storedNewAppIds = localStorage.getItem(`newAppIds_${shadowOrgId}`)
        console.log('Loading from localStorage:', storedNewAppIds)
        if (storedNewAppIds) {
          try {
            const parsedIds = JSON.parse(storedNewAppIds)
            console.log('Parsed IDs:', parsedIds)
            
            // CLEANUP: Filter out any newAppIds that no longer exist in the database
            const validNewAppIds = parsedIds.filter((id: string) => currentAppIds.includes(id))
            console.log('Valid new app IDs after cleanup:', validNewAppIds)
            
            setNewAppIds(new Set(validNewAppIds))
            
            // Update localStorage if cleanup occurred
            if (validNewAppIds.length !== parsedIds.length) {
              console.log('Cleaned up invalid new app IDs from localStorage')
              localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(validNewAppIds))
            }
          } catch (error) {
            console.error('Error parsing new app IDs:', error)
            // Reset to empty if corrupted
            setNewAppIds(new Set())
            localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify([]))
          }
        } else {
          // If no stored new app IDs, initialize all apps as new
          console.log('No stored new app IDs, initializing all apps as new')
          setNewAppIds(new Set(currentAppIds))
          localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(currentAppIds))
        }
        
        // No auto-selection needed for table view
        console.log('Successfully loaded apps:', appsData.length)
      } catch (error) {
        console.error('Error loading apps:', error)
        // Set apps to empty array on error to show empty state
        setApps([])
      } finally {
        setIsLoading(false)
      }
    }

    loadApps()
  }, [shadowOrgId, fullShadowOrgIds])

  // Fetch user info
  const fetchUserInfo = async () => {
    try {
      const response = await fetch('/api/session-info');
      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }
  };

  // Fetch user info on component mount
  useEffect(() => {
    fetchUserInfo();
  }, []);

  // Sidebar handlers
  const handleSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  const handleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  const handleViewChange = (view: string) => {
    setCurrentView(view)
    if (view === 'applications') {
      router.push('/');
    } else if (view === 'ai-risk-analysis') {
      router.push('/ai-risk-analysis');
    } else if (view === 'organize-app-inbox') {
      // Stay on current page
    } else if (view === 'email-notifications') {
      router.push('/settings?view=email-notifications');
    } else if (view === 'organization-settings') {
      router.push('/settings?view=organization-settings');
    } else if (view === 'app-inbox-settings') {
      router.push('/settings?view=authentication');
    }
    setIsSidebarOpen(false)
  }

  const handleSignOut = async () => {
    const { signOut } = await import('@/lib/auth-utils');
    await signOut({
      showLoginModal: false,
      redirectUrl: '/',
      suppressErrors: false
    });
  }

  // Handle organization settings update
  const handleOrgSettingsUpdate = (newSettings: OrganizationSettings) => {
    setOrgSettings(newSettings)
    // Save to localStorage
    if (shadowOrgId) {
      localStorage.setItem(`orgSettings_${shadowOrgId}`, JSON.stringify(newSettings))
    }
  }

  // Convert OrganizeApp to App for compatibility with existing components
  const transformedApps = apps.map(organizeAppToApp)
  const filteredApps = applyFilters(transformedApps, filters, searchQuery)

  const handleAddApps = async (newApps: App[]) => {
    if (!shadowOrgId) return

    try {
      // Use full shadow org IDs for app inbox operations if available, otherwise fall back to single shadow org ID
      const operationShadowOrgId = fullShadowOrgIds || shadowOrgId;
      
      // Convert App to OrganizeApp and save to database
      const organizeApps = newApps.map(app => appToOrganizeApp(app, operationShadowOrgId))
      const savedApps = await Promise.all(
        organizeApps.map(app => organizeApi.createApp(app, operationShadowOrgId))
      )
      
      setApps([...apps, ...savedApps])
      setIsAddDialogOpen(false)
      
      // Track new app IDs in localStorage
      const newIds = savedApps.map(app => app.id)
      const updatedNewAppIds = new Set([...newAppIds, ...newIds])
      console.log('New app IDs added:', newIds)
      console.log('Updated newAppIds:', Array.from(updatedNewAppIds))
      setNewAppIds(updatedNewAppIds)
      localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(Array.from(updatedNewAppIds)))
      
      // Also update the allAppIds to include the new apps
      const updatedApps = [...apps, ...savedApps]
      const allAppIds = updatedApps.map(app => app.id)
      localStorage.setItem(`allAppIds_${shadowOrgId}`, JSON.stringify(allAppIds))
      
      // Auto-open edit mode for the last added app
      if (savedApps.length > 0) {
        const lastAddedApp = savedApps[savedApps.length - 1]
        setSelectedApp(lastAddedApp)
        setIsEditMode(true)
        setIsDetailTrayOpen(true)
      }
    } catch (error) {
      console.error('Error adding apps:', error)
      // TODO: Show error message to user
    }
  }

  const handleUpdateApp = async (updatedApp: App) => {
    if (!shadowOrgId) return

    try {
      // Use full shadow org IDs for app inbox operations if available, otherwise fall back to single shadow org ID
      const operationShadowOrgId = fullShadowOrgIds || shadowOrgId;
      console.log('handleUpdateApp - shadowOrgId:', shadowOrgId)
      console.log('handleUpdateApp - fullShadowOrgIds:', fullShadowOrgIds)
      console.log('handleUpdateApp - operationShadowOrgId:', operationShadowOrgId)
      console.log('handleUpdateApp - updatedApp:', updatedApp)
      
      // Convert App to OrganizeApp for API call
      const organizeApp = appToOrganizeApp(updatedApp, operationShadowOrgId)
      const savedApp = await organizeApi.updateApp({ ...organizeApp, id: updatedApp.id } as OrganizeApp, operationShadowOrgId)
      setApps(apps.map((app) => (app.id === savedApp.id ? savedApp : app)))
      
      // Update selectedApp if it's the same app being updated
      if (selectedApp && selectedApp.id === savedApp.id) {
        setSelectedApp(savedApp)
      }

      // Sync with Shadow IT if managedStatus was changed
      if (updatedApp.managedStatus) {
        // Use full shadow org IDs for sync if available, otherwise fall back to single shadow org ID
        const syncShadowOrgId = fullShadowOrgIds || shadowOrgId;
        console.log('Syncing to Shadow IT - appName:', updatedApp.name)
        console.log('Syncing to Shadow IT - managementStatus:', updatedApp.managedStatus)
        console.log('Syncing to Shadow IT - shadowOrgId:', syncShadowOrgId)
        
        const syncResponse = await fetch('/api/applications/by-name', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appName: updatedApp.name,
                managementStatus: updatedApp.managedStatus,
                shadowOrgId: syncShadowOrgId
            })
        });

        if (!syncResponse.ok) {
          const errorData = await syncResponse.json();
          console.error('Failed to sync status to Shadow IT:', errorData);
        } else {
          const successData = await syncResponse.json();
          console.log('Successfully synced status to Shadow IT:', successData);
        }
      }

    } catch (error) {
      console.error('Error updating app:', error)
      // TODO: Show error message to user
    }
  }

  const handleRemoveApp = async (appId: string) => {
    if (!shadowOrgId) return

    try {
      // Use full shadow org IDs for app inbox operations if available, otherwise fall back to single shadow org ID
      const operationShadowOrgId = fullShadowOrgIds || shadowOrgId;
      
      await organizeApi.deleteApp(appId, operationShadowOrgId)
      const updatedApps = apps.filter((app) => app.id !== appId)
      setApps(updatedApps)
      
      // Update allAppIds localStorage to reflect removal
      const allAppIds = updatedApps.map(app => app.id)
      localStorage.setItem(`allAppIds_${shadowOrgId}`, JSON.stringify(allAppIds))
      
      // Remove deleted app from newAppIds localStorage to fix badge count
      const updatedNewAppIds = new Set(newAppIds)
      updatedNewAppIds.delete(appId)
      setNewAppIds(updatedNewAppIds)
      localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(Array.from(updatedNewAppIds)))
      
      // If the removed app was selected in tray, close tray
      if (selectedApp && selectedApp.id === appId) {
        setSelectedApp(null)
        setIsDetailTrayOpen(false)
      }
    } catch (error) {
      console.error('Error removing app:', error)
      // TODO: Show error message to user
    }
  }

  const logout = () => {
    // Clear cookies and localStorage
    document.cookie = 'orgId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    document.cookie = 'userEmail=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    document.cookie = 'shadow_session_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    localStorage.clear()
    // Redirect to main site
    window.location.href = 'https://www.manage.stitchflow.io/'
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar */}
        <Sidebar
          isOpen={isSidebarOpen}
          isCollapsed={isSidebarCollapsed}
          onToggle={handleSidebarToggle}
          onCollapse={handleSidebarCollapse}
          currentView={currentView}
          onViewChange={handleViewChange}
          userInfo={userInfo}
          onSignOut={handleSignOut}
        />

        {/* Main Content */}
        <div className={`flex-1 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'
        }`}>
          <div className="flex h-screen bg-bg-light items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4" />
              <p className="text-gray-600">Loading your apps...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleViewApp = (app: any) => {
    // Convert the transformed app back to OrganizeApp format
    const organizeApp = apps.find(a => a.id === app.id)
    if (organizeApp) {
      // Remove from new apps when viewed
      markAppAsViewed(app.id)
      setSelectedApp(organizeApp)
      setIsEditMode(false)
      setIsDetailTrayOpen(true)
    }
  }

  const handleEditApp = (app: any) => {
    // Convert the transformed app back to OrganizeApp format
    const organizeApp = apps.find(a => a.id === app.id)
    if (organizeApp) {
      // Remove from new apps when edited
      markAppAsViewed(app.id)
      setSelectedApp(organizeApp)
      setIsEditMode(true)
      setIsDetailTrayOpen(true)
    }
  }

  const markAppAsViewed = (appId: string) => {
    if (newAppIds.has(appId) && shadowOrgId) {
      const updatedNewAppIds = new Set(newAppIds)
      updatedNewAppIds.delete(appId)
      setNewAppIds(updatedNewAppIds)
      localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(Array.from(updatedNewAppIds)))
    }
  }

  const markAllAsRead = () => {
    if (shadowOrgId) {
      setNewAppIds(new Set())
      localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify([]))
    }
  }

  const handleBulkRemove = async (appIds: string[]) => {
    if (!shadowOrgId || appIds.length === 0) return

    try {
      // Use full shadow org IDs for app inbox operations if available, otherwise fall back to single shadow org ID
      const operationShadowOrgId = fullShadowOrgIds || shadowOrgId;
      
      // Remove apps one by one
      for (const appId of appIds) {
        await organizeApi.deleteApp(appId, operationShadowOrgId)
      }
      
      // Update the apps list
      const updatedApps = apps.filter((app) => !appIds.includes(app.id))
      setApps(updatedApps)
      
      // Update allAppIds localStorage to reflect removal
      const allAppIds = updatedApps.map(app => app.id)
      localStorage.setItem(`allAppIds_${shadowOrgId}`, JSON.stringify(allAppIds))
      
      // Remove deleted apps from newAppIds localStorage to fix badge count
      const updatedNewAppIds = new Set(newAppIds)
      appIds.forEach(appId => updatedNewAppIds.delete(appId))
      setNewAppIds(updatedNewAppIds)
      localStorage.setItem(`newAppIds_${shadowOrgId}`, JSON.stringify(Array.from(updatedNewAppIds)))
      
      // Clear selection
      setSelectedAppIds(new Set())
      
      // If any of the removed apps were selected in tray, close tray
      if (selectedApp && appIds.includes(selectedApp.id)) {
        setSelectedApp(null)
        setIsDetailTrayOpen(false)
      }
    } catch (error) {
      console.error('Error removing apps:', error)
      // TODO: Show error message to user
    }
  }

  const currentAppIndex = selectedApp ? filteredApps.findIndex(app => app.id === selectedApp.id) : -1

  // Check if organization settings are configured
  const hasOrgSettings = orgSettings?.identityProvider && orgSettings?.emailProvider

  console.log('Main component - newAppIds:', Array.from(newAppIds))
  console.log('Main component - newAppIds.size:', newAppIds.size)

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        onToggle={handleSidebarToggle}
        onCollapse={handleSidebarCollapse}
        currentView={currentView}
        onViewChange={handleViewChange}
        userInfo={userInfo}
        onSignOut={handleSignOut}
      />

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'
      }`}>
  
        <div className="min-h-screen bg-bg-light relative">
          {/* Overlay when tray is open */}
          {isDetailTrayOpen && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-5 z-30 transition-opacity duration-300"
              onClick={() => {
                setIsDetailTrayOpen(false)
                setSelectedApp(null)
                setIsEditMode(false)
              }}
            />
          )}
          
          {/* Banner for incomplete settings */}
          {!hasOrgSettings && apps.length > 0 && (
            <div className="bg-yellow-100 border-b-2 border-yellow-200 p-4 text-center text-sm text-yellow-800">
              Your organization settings are incomplete. Please configure your Identity and Email providers in{' '}
              <button onClick={() => router.push('/settings?view=authentication')} className="font-bold underline hover:text-yellow-900">
                IDP settings
              </button>
              .
            </div>
          )}

          {/* Main content */}
          <div className="max-w-7xl mx-auto p-6">
        {apps.length === 0 ? (
          <SimpleEmptyState 
            onAddApp={() => setIsAddDialogOpen(true)} 
            orgSettings={orgSettings}
            onSettingsUpdate={handleOrgSettingsUpdate}
          />
        ) : (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-900">Managed Apps</h1>
              <div className="flex items-center gap-3">
                {selectedAppIds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove {selectedAppIds.size} app{selectedAppIds.size !== 1 ? 's' : ''}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-h4 text-primary-text font-semibold">Remove Apps</AlertDialogTitle>
                        <AlertDialogDescription className="text-body text-secondary-text">
                          Are you sure you want to remove {selectedAppIds.size} selected app{selectedAppIds.size !== 1 ? 's' : ''} from your Managed Apps? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-gray-200 text-secondary-text hover:bg-gray-50 font-medium">Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => handleBulkRemove(Array.from(selectedAppIds))}
                          className="bg-red-600 hover:bg-red-700 text-white font-medium border-red-600 hover:border-red-700"
                        >
                          Remove Apps
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add app
                </Button>
                {newAppIds.size > 0 && (
                  <Button onClick={markAllAsRead} size="sm" variant="outline">
                    <Check className="h-4 w-4 mr-2" />
                    Mark all as read
                  </Button>
                )}
              </div>
            </div>

            {/* Search and Filters */}
            <AppFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filters={filters}
              onFiltersChange={setFilters}
              totalApps={apps.length}
              filteredCount={filteredApps.length}
            />

            {/* Table */}
            <AppTable 
              apps={filteredApps} 
              onViewApp={handleViewApp}
              onEditApp={handleEditApp}
              onRemoveApp={handleRemoveApp}
              onBulkRemove={handleBulkRemove}
              newAppIds={newAppIds}
              selectedAppIds={selectedAppIds}
              onSelectionChange={setSelectedAppIds}
            />
          </div>
        )}
          </div>

          {/* Right Tray */}
          <SimpleAppDetailTray
            app={selectedApp ? organizeAppToApp(selectedApp) : null}
            isOpen={isDetailTrayOpen}
            isEditMode={isEditMode}
            onClose={() => {
              setIsDetailTrayOpen(false)
              setSelectedApp(null)
              setIsEditMode(false)
            }}
            onUpdateApp={handleUpdateApp}
            onRemoveApp={handleRemoveApp}
            onPrevious={currentAppIndex > 0 ? () => {
              const prevApp = filteredApps[currentAppIndex - 1]
              const organizeApp = apps.find(a => a.id === prevApp.id)
              if (organizeApp) setSelectedApp(organizeApp)
            } : undefined}
            onNext={currentAppIndex < filteredApps.length - 1 ? () => {
              const nextApp = filteredApps[currentAppIndex + 1]
              const organizeApp = apps.find(a => a.id === nextApp.id)
              if (organizeApp) setSelectedApp(organizeApp)
            } : undefined}
            hasPrevious={currentAppIndex > 0}
            hasNext={currentAppIndex < filteredApps.length - 1}
            organization={orgSettings}
            shadowOrgId={shadowOrgId}
          />

          <SimpleAddAppsDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen} 
            onAddApps={handleAddApps} 
            existingApps={transformedApps}
            orgSettings={orgSettings}
          />
        </div>
      </div>
    </div>
  )
}

export default function AppInbox() {
  return <AppInboxContent />
} 