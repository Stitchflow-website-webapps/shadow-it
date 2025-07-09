"use client"
import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { KeyRound, Users, Link, CreditCard, Trash2, Edit2, Check, X, Save } from "lucide-react"
import type { App } from "@/types/app"
import { EditableCard } from "@/components/editable-card"
interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

interface UserInfo {
  orgId: string
}

interface AppDetailProps {
  app: App
  onUpdateApp: (app: App) => void
  onRemoveApp: (appId: string) => void
  initialEditMode?: boolean
  orgSettings?: OrganizationSettings | null
  userInfo?: UserInfo | null
}

export function AppDetail({ app, onUpdateApp, onRemoveApp, initialEditMode = false, orgSettings, userInfo }: AppDetailProps) {
  const [isEditMode, setIsEditMode] = useState(initialEditMode)
  const [editedFields, setEditedFields] = useState<Partial<App>>({})
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  
  // Reset edit mode when app changes
  useEffect(() => {
    setIsEditMode(initialEditMode)
    setEditedFields({})
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
    const updatedApp = { ...app, ...editedFields }
    onUpdateApp(updatedApp)
    setIsEditMode(false)
    setEditedFields({})
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
    const idp = orgSettings?.identityProvider

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
          <p className="text-sm text-gray-500 mt-1">{editedFields.appPlan ?? (app.appPlan || "—")}</p>
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
                  <Button variant="outline" size="sm" className="text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300">
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
                      className="text-white"
                      style={{ backgroundColor: '#363338' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a282c'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#363338'}
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

      {/* 2x2 Card Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Authentication Card */}
        <EditableCard
          title="Authentication"
          icon={<KeyRound className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={handleFieldChange}
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
            },
          ]}
        />

        {/* App Management Card */}
        <EditableCard
          title="App Management"
          icon={<Link className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={(updates) => handleFieldChange(updates)}
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
                { value: "Newly discovered", label: "Newly discovered" },
                { value: "Unknown", label: "Unknown" },
                { value: "Ignore", label: "Ignore" },
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
              placeholder: "Describe what the app is used for",
            },
          ]}
        />

        {/* License & Renewal Card */}
        <EditableCard
          title="License & Renewal"
          icon={<CreditCard className="h-5 w-5 text-primary-text" />}
          isEditing={isEditMode}
          onUpdate={handleFieldChange}
          appName={app.name}
          userInfo={userInfo}
          fields={[
            {
              label: "Renewal Type",
              value: editedFields.appPlan ?? (app.appPlan || ""),
              field: "appPlan",
              type: "select",
              placeholder: "Select renewal type",
              options: [
                { value: "Annual Plan", label: "Annual Plan" },
                { value: "Monthly Plan", label: "Monthly Plan" },
                { value: "Quarterly", label: "Quarterly" },
                { value: "Usage Based", label: "Usage Based" },
                { value: "Other", label: "Other" },
              ],
            },
            {
              label: "RENEWAL DATE",
              value: editedFields.renewalDate ?? (app.renewalDate || ""),
              field: "renewalDate",
              type: "date",
              placeholder: "Pick a date",
            },
            {
              label: "PLAN LIMIT",
              value: editedFields.planLimit ?? (app.planLimit || ""),
              field: "planLimit",
              type: "input",
              placeholder: "Enter plan limit",
            },
            {
              label: "# LICENSES USED UP",
              value: editedFields.licensesUsed?.toString() ?? (app.licensesUsed?.toString() || ""),
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
  )
}
