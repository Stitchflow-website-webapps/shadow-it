"use client"

import { useState } from "react"
import { Plus, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

interface EmptyStateProps {
  onAddApp: () => void
  orgSettings?: OrganizationSettings | null
  onUpdateOrgSettings?: (settings: OrganizationSettings) => void
}

export function EmptyState({ onAddApp, orgSettings, onUpdateOrgSettings }: EmptyStateProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [tempSettings, setTempSettings] = useState({
    identityProvider: orgSettings?.identityProvider || '',
    emailProvider: orgSettings?.emailProvider || ''
  })

  const handleOrgSettingsUpdate = async () => {
    if (!tempSettings.identityProvider || !tempSettings.emailProvider || !onUpdateOrgSettings) {
      return
    }

    try {
      setIsUpdating(true)
      await onUpdateOrgSettings(tempSettings)
    } catch (error) {
      console.error('Failed to update org settings:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const hasOrgSettings = orgSettings?.identityProvider && orgSettings?.emailProvider

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center p-6 space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-gray-900">Welcome to App List</h1>
        <p className="text-lg text-gray-600">
          {hasOrgSettings 
            ? "Your organization is configured. Add your first app to get started." 
            : "Configure your organization settings below to start adding apps."
          }
        </p>
      </div>

      {/* Organization Settings */}
      <div className="w-full max-w-md">
        {!hasOrgSettings ? (
          <Card className="border-dashed border-2 border-gray-200">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center justify-center gap-2">
                <Settings className="h-4 w-4" />
                Organization Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div>
                <Label htmlFor="org-identity-provider" className="text-sm font-medium">Identity Provider</Label>
                <Select 
                  value={tempSettings.identityProvider} 
                  onValueChange={(value) => setTempSettings(prev => ({ ...prev, identityProvider: value }))}
                >
                  <SelectTrigger id="org-identity-provider" className="mt-2 h-10">
                    <SelectValue placeholder="Select identity provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Okta">Okta</SelectItem>
                    <SelectItem value="Entra ID/Azure AD">Entra ID/Azure AD</SelectItem>
                    <SelectItem value="Google Workspace">Google Workspace</SelectItem>
                    <SelectItem value="JumpCloud">JumpCloud</SelectItem>
                    <SelectItem value="Onelogin">Onelogin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="org-email-provider" className="text-sm font-medium">Email Provider</Label>
                <Select 
                  value={tempSettings.emailProvider} 
                  onValueChange={(value) => setTempSettings(prev => ({ ...prev, emailProvider: value }))}
                >
                  <SelectTrigger id="org-email-provider" className="mt-2 h-10">
                    <SelectValue placeholder="Select email provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Google">Google</SelectItem>
                    <SelectItem value="Microsoft">Microsoft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Button 
                onClick={handleOrgSettingsUpdate} 
                disabled={!tempSettings.identityProvider || !tempSettings.emailProvider || isUpdating}
                size="default"
                className="w-full"
              >
                {isUpdating ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-700 space-y-1 text-center">
              <p><span className="font-medium">Identity Provider:</span> {orgSettings.identityProvider}</p>
              <p><span className="font-medium">Email Provider:</span> {orgSettings.emailProvider}</p>
            </div>
          </div>
        )}
      </div>

      {/* Add App Button */}
      <div className="flex flex-col items-center">
        {hasOrgSettings ? (
          <Button onClick={onAddApp} size="lg" className="text-base px-6 py-3">
            <Plus className="h-5 w-5 mr-2" />
            Add your first app
          </Button>
        ) : (
          <div className="text-center space-y-2">
            <Button disabled size="lg" className="text-base px-6 py-3 opacity-50 cursor-not-allowed">
              <Plus className="h-5 w-5 mr-2" />
              Add your first app
            </Button>
            <p className="text-sm text-gray-500">
              Configure organization settings above to add apps
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
