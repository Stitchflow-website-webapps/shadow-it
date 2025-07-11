"use client"

import { useState, useEffect, useMemo } from "react"
import { Plus, Settings, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppTable } from "@/components/app-table"
import { AppDetailTray } from "@/components/app-detail-tray"
import { EmptyState } from "@/components/empty-state"
import { AppFilters, type FilterCondition } from "@/components/app-filters"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { organizeApi } from "@/lib/organize-api"
import { applyFilters } from "@/lib/filter-utils"
import { organizeAppToApp, appToOrganizeApp } from "@/lib/organize-type-adapter"
import { useAppIntegrations, type AppIntegration } from "@/hooks/use-app-integrations"
import { cn } from "@/lib/utils"
import type { OrganizeApp } from "@/lib/supabase/organize-client"
import type { App } from "@/types/app"
import { OrgSettingsDialog } from "@/components/org-settings"


// Import all the helper components from the original file
interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

// Use the updated OrgSettingsDialog component

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
        owner: "",
        comment: "",
        appPlan: "",
        planLimit: "",
        planReference: "",
        licensesUsed: null,
        renewalDate: ""
      }
    })

    onAddApps(appsToAdd)
    setSelectedApps(new Set())
  }

  const handleClose = () => {
    setSelectedApps(new Set())
    setSearchQuery("")
    setCustomApps([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Apps
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search for apps or add custom app..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Add Custom App Button */}
          {searchQuery.trim() && !hasExactMatch && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCustomApp}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add "{searchQuery.trim()}" as custom app
            </Button>
          )}

          {/* App List */}
          <ScrollArea className="h-[300px] border rounded-md p-4">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 mx-auto mb-4" />
                  <p className="text-gray-600">Loading apps...</p>
                </div>
              ) : filteredApps.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery.trim() ? "No apps found matching your search." : "No apps available."}
                </div>
              ) : (
                filteredApps.map((app) => (
                  <div
                    key={app.name}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                      selectedApps.has(app.name) ? "bg-blue-50 border-blue-200" : "hover:bg-gray-50"
                    )}
                    onClick={() => handleToggleApp(app.name)}
                  >
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        checked={selectedApps.has(app.name)}
                        onChange={() => handleToggleApp(app.name)}
                      />
                      <div>
                        <div className="font-medium">{app.name}</div>
                        <div className="text-sm text-gray-500">{app.connectionStatus}</div>
                      </div>
                    </div>
                    {customApps.some((customApp) => customApp.name === app.name) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveCustomApp(app.name)
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Selected Apps Count */}
          {selectedApps.size > 0 && (
            <div className="text-sm text-gray-600">
              {selectedApps.size} app{selectedApps.size !== 1 ? 's' : ''} selected
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAddApps} disabled={selectedApps.size === 0}>
            Add {selectedApps.size} app{selectedApps.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Main component
export function OrganizeAppInbox() {
  const [apps, setApps] = useState<OrganizeApp[]>([])
  const [selectedApp, setSelectedApp] = useState<OrganizeApp | null>(null)
  const [isDetailTrayOpen, setIsDetailTrayOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [shadowOrgId, setShadowOrgId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null)

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

    // Load organization settings from localStorage first
    const savedSettings = localStorage.getItem(`orgSettings_${orgId}`)
    if (savedSettings) {
      try {
        setOrgSettings(JSON.parse(savedSettings))
      } catch (error) {
        console.error('Error parsing org settings:', error)
      }
    }

    // Also try to load from the database if not in localStorage
    const loadOrgSettings = async () => {
      if (!orgId) return
      
      try {
        // First try to get organization settings from the organizations table
        const response = await fetch(`/api/organize/organization?shadowOrgId=${orgId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        
        if (response.ok) {
          const organization = await response.json()
          if (organization && organization.identity_provider && organization.email_provider) {
            const settings = {
              identityProvider: organization.identity_provider,
              emailProvider: organization.email_provider
            }
            
            setOrgSettings(settings)
            // Save to localStorage for future use
            localStorage.setItem(`orgSettings_${orgId}`, JSON.stringify(settings))
            return
          }
        }
        
        // Fallback: check if we have any apps (means org exists but settings not configured)
        const appsResponse = await fetch(`/api/organize/apps?shadowOrgId=${orgId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        
        if (appsResponse.ok) {
          const apps = await appsResponse.json()
          if (apps && apps.length > 0) {
            // Organization exists but settings not properly configured
            // Set default settings to allow the user to configure them
            const defaultSettings = {
              identityProvider: 'Google Workspace',
              emailProvider: 'Google'
            }
            
            setOrgSettings(defaultSettings)
            localStorage.setItem(`orgSettings_${orgId}`, JSON.stringify(defaultSettings))
          }
        }
      } catch (error) {
        console.error('Error loading organization settings:', error)
      }
    }

    if (!savedSettings) {
      loadOrgSettings()
    }
  }, [])

  // Load apps from database when shadowOrgId is available
  useEffect(() => {
    const loadApps = async () => {
      if (!shadowOrgId) return
      
      try {
        setIsLoading(true)
        const appsData = await organizeApi.getApps(shadowOrgId)
        setApps(appsData)
      } catch (error) {
        console.error('Error loading apps:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadApps()
  }, [shadowOrgId])

  // Handle organization settings update
  const handleOrgSettingsUpdate = async (newSettings: OrganizationSettings) => {
    setOrgSettings(newSettings)
    
    // Save to localStorage
    if (shadowOrgId) {
      localStorage.setItem(`orgSettings_${shadowOrgId}`, JSON.stringify(newSettings))
      
      // Also save to database
      try {
        await fetch('/api/organize/organization', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shadowOrgId,
            identity_provider: newSettings.identityProvider,
            email_provider: newSettings.emailProvider
          })
        })
      } catch (error) {
        console.error('Error saving organization settings to database:', error)
      }
    }
  }

  // Convert OrganizeApp to App for compatibility with existing components
  const transformedApps = apps.map(organizeAppToApp)
  const filteredApps = applyFilters(transformedApps, filters, searchQuery)

  const handleAddApps = async (newApps: App[]) => {
    if (!shadowOrgId) return

    try {
      // Convert App to OrganizeApp and save to database
      const organizeApps = newApps.map(app => appToOrganizeApp(app, shadowOrgId))
      const savedApps = await Promise.all(
        organizeApps.map(app => organizeApi.createApp(app, shadowOrgId))
      )
      
      setApps([...apps, ...savedApps])
      setIsAddDialogOpen(false)
      
      // Auto-open edit mode for the last added app
      if (savedApps.length > 0) {
        const lastAddedApp = savedApps[savedApps.length - 1]
        setSelectedApp(lastAddedApp)
        setIsEditMode(true)
        setIsDetailTrayOpen(true)
      }
    } catch (error) {
      console.error('Error adding apps:', error)
    }
  }

  const handleUpdateApp = async (updatedApp: App) => {
    if (!shadowOrgId) return

    try {
      // Convert App to OrganizeApp for API call
      const organizeApp = appToOrganizeApp(updatedApp, shadowOrgId)
      const savedApp = await organizeApi.updateApp({ ...organizeApp, id: updatedApp.id } as OrganizeApp, shadowOrgId)
      setApps(apps.map((app) => (app.id === savedApp.id ? savedApp : app)))
      
      // Update selectedApp if it's the same app being updated
      if (selectedApp && selectedApp.id === savedApp.id) {
        setSelectedApp(savedApp)
      }
    } catch (error) {
      console.error('Error updating app:', error)
    }
  }

  const handleRemoveApp = async (appId: string) => {
    if (!shadowOrgId) return

    try {
      await organizeApi.deleteApp(appId, shadowOrgId)
      const updatedApps = apps.filter((app) => app.id !== appId)
      setApps(updatedApps)
      
      // If the removed app was selected in tray, close tray
      if (selectedApp && selectedApp.id === appId) {
        setSelectedApp(null)
        setIsDetailTrayOpen(false)
      }
    } catch (error) {
      console.error('Error removing app:', error)
    }
  }

  const logout = () => {
    // Clear cookies and localStorage
    document.cookie = 'orgId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    document.cookie = 'userEmail=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    document.cookie = 'shadow_session_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    localStorage.clear()
    // Redirect to main site
    window.location.href = 'https://managed.stitchflow.com/'
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your apps...</p>
        </div>
      </div>
    )
  }

  const handleViewApp = (app: any) => {
    // Convert the transformed app back to OrganizeApp format
    const organizeApp = apps.find(a => a.id === app.id)
    if (organizeApp) {
      setSelectedApp(organizeApp)
      setIsEditMode(false)
      setIsDetailTrayOpen(true)
    }
  }

  const handleEditApp = (app: any) => {
    // Convert the transformed app back to OrganizeApp format
    const organizeApp = apps.find(a => a.id === app.id)
    if (organizeApp) {
      setSelectedApp(organizeApp)
      setIsEditMode(true)
      setIsDetailTrayOpen(true)
    }
  }

  const currentAppIndex = selectedApp ? filteredApps.findIndex(app => app.id === selectedApp.id) : -1

  // Check if organization settings are configured
  const hasOrgSettings = orgSettings?.identityProvider && orgSettings?.emailProvider

  return (
    <div className="h-full bg-white relative">
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
      
      {/* Main content */}
      <div className="max-w-7xl mx-auto p-6">
        {apps.length === 0 || !hasOrgSettings ? (
          <EmptyState 
            onAddApp={() => setIsAddDialogOpen(true)} 
            orgSettings={orgSettings}
            onUpdateOrgSettings={handleOrgSettingsUpdate}
          />
        ) : (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {userEmail && (
                  <p className="text-sm text-gray-500">Welcome, {userEmail}!</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                
                <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add app
                </Button>
                

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
            />
          </div>
        )}
      </div>

      {/* Right Tray */}
      <AppDetailTray
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
        orgSettings={orgSettings}
        shadowOrgId={shadowOrgId}
      />

      {hasOrgSettings && (
        <SimpleAddAppsDialog 
          open={isAddDialogOpen} 
          onOpenChange={setIsAddDialogOpen} 
          onAddApps={handleAddApps} 
          existingApps={transformedApps}
          orgSettings={orgSettings}
        />
      )}
    </div>
  )
} 