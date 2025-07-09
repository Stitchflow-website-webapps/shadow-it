"use client"

import { useState } from "react"
import { Settings, Edit2, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

interface OrgSettingsDialogProps {
  children: React.ReactNode
  orgSettings?: OrganizationSettings | null
  onUpdateOrgSettings?: (settings: OrganizationSettings) => void
}

export function OrgSettingsDialog({ children, orgSettings, onUpdateOrgSettings }: OrgSettingsDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [tempSettings, setTempSettings] = useState({
    identityProvider: orgSettings?.identityProvider || '',
    emailProvider: orgSettings?.emailProvider || ''
  })

  const handleEdit = () => {
    setTempSettings({
      identityProvider: orgSettings?.identityProvider || '',
      emailProvider: orgSettings?.emailProvider || ''
    })
    setIsEditing(true)
  }

  const handleCancel = () => {
    setTempSettings({
      identityProvider: orgSettings?.identityProvider || '',
      emailProvider: orgSettings?.emailProvider || ''
    })
    setIsEditing(false)
  }

  const handleSave = async () => {
    if (!tempSettings.identityProvider || !tempSettings.emailProvider || !onUpdateOrgSettings) {
      return
    }

    try {
      setIsUpdating(true)
      await onUpdateOrgSettings(tempSettings)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update org settings:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      // Reset editing state when dialog closes
      setIsEditing(false)
      setTempSettings({
        identityProvider: orgSettings?.identityProvider || '',
        emailProvider: orgSettings?.emailProvider || ''
      })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Organization Settings
          </DialogTitle>
          {!isEditing && (
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="py-4">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-identity-provider">Identity Provider</Label>
                <Select 
                  value={tempSettings.identityProvider} 
                  onValueChange={(value) => setTempSettings(prev => ({ ...prev, identityProvider: value }))}
                >
                  <SelectTrigger id="edit-identity-provider" className="mt-1">
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
                <Label htmlFor="edit-email-provider">Email Provider</Label>
                <Select 
                  value={tempSettings.emailProvider} 
                  onValueChange={(value) => setTempSettings(prev => ({ ...prev, emailProvider: value }))}
                >
                  <SelectTrigger id="edit-email-provider" className="mt-1">
                    <SelectValue placeholder="Select email provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Google">Google</SelectItem>
                    <SelectItem value="Microsoft">Microsoft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button 
                  onClick={handleSave} 
                  disabled={!tempSettings.identityProvider || !tempSettings.emailProvider || isUpdating}
                  size="sm"
                >
                  <Check className="h-4 w-4 mr-2" />
                  {isUpdating ? 'Saving...' : 'Save'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleCancel} 
                  disabled={isUpdating}
                  size="sm"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium text-gray-600">Identity Provider</Label>
                <p className="text-sm text-gray-900 mt-1">
                  {orgSettings?.identityProvider || '—'}
                </p>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-600">Email Provider</Label>
                <p className="text-sm text-gray-900 mt-1">
                  {orgSettings?.emailProvider || '—'}
                </p>
              </div>
              {(!orgSettings?.identityProvider || !orgSettings?.emailProvider) && (
                <p className="text-sm text-amber-600">
                  ⚠️ Organization settings are required to add apps
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
} 