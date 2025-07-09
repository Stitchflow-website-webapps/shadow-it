"use client"

import { useState, useMemo } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useAppIntegrations, type AppIntegration } from "@/hooks/use-app-integrations"

interface AppSelectorProps {
  value: string
  onValueChange: (value: string) => void
  onConnectionStatusChange: (status: string) => void
}

export function AppSelector({ value, onValueChange, onConnectionStatusChange }: AppSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customAppName, setCustomAppName] = useState("")
  const { integrations, loading } = useAppIntegrations()

  const selectedIntegration = integrations.find((integration) => integration.name === value)

  const handleSelect = (integration: AppIntegration) => {
    onValueChange(integration.name)
    onConnectionStatusChange(integration.connectionStatus)
    setOpen(false)
    setShowCustomInput(false)
  }

  const handleCustomApp = () => {
    if (customAppName.trim()) {
      onValueChange(customAppName.trim())
      onConnectionStatusChange("No") // Default for custom apps
      setShowCustomInput(false)
      setCustomAppName("")
      setOpen(false)
    }
  }

  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => integration.name.toLowerCase().includes(value.toLowerCase()))
  }, [integrations, value])

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>App Name</Label>
        <div className="h-10 bg-muted animate-pulse rounded-md" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label>App Name</Label>
      {showCustomInput ? (
        <div className="flex gap-2">
          <Input
            value={customAppName}
            onChange={(e) => setCustomAppName(e.target.value)}
            placeholder="Enter custom app name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomApp()
              }
            }}
          />
          <Button onClick={handleCustomApp} size="sm">
            Add
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowCustomInput(false)
              setCustomAppName("")
            }}
            size="sm"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
              {value || "Select app..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0">
            <Command>
              <CommandInput placeholder="Search apps..." />
              <CommandList>
                <CommandEmpty>
                  <div className="p-2 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No app found.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCustomInput(true)
                        setOpen(false)
                      }}
                      className="w-full"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Custom App
                    </Button>
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {filteredIntegrations.map((integration) => (
                    <CommandItem
                      key={integration.name}
                      value={integration.name}
                      onSelect={() => handleSelect(integration)}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === integration.name ? "opacity-100" : "opacity-0")} />
                      <div className="flex-1">
                        <div className="font-medium">{integration.name}</div>
                        <div className="text-xs text-muted-foreground">{integration.connectionStatus}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setShowCustomInput(true)
                      setOpen(false)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Custom App
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {selectedIntegration && (
        <div className="text-xs text-muted-foreground">Connection Status: {selectedIntegration.connectionStatus}</div>
      )}
    </div>
  )
}
