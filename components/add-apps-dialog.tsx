"use client"

import { useState, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Plus, X, ChevronDown, ChevronUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { App } from "@/types/app"
import { useAppIntegrations, type AppIntegration } from "@/hooks/use-app-integrations"

interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

interface AddAppsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddApps: (apps: App[]) => void
  existingApps: App[]
  orgSettings: OrganizationSettings | null
}

export function AddAppsDialog({ open, onOpenChange, onAddApps, existingApps, orgSettings }: AddAppsDialogProps) {
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
        id: crypto.randomUUID(), // Generate proper UUID
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
        costPerUser: "",
        renewalDate: "",
        contractUrl: "",
        licensesUsed: null,
        usageDescription: "",
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

            {/* Available Apps - Selected apps first, then unselected */}
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
