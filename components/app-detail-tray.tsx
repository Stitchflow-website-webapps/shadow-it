"use client"

import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppDetail } from "@/components/app-detail"
import type { App } from "@/types/app"
import { cn } from "@/lib/utils"

interface OrganizationSettings {
  identityProvider: string
  emailProvider: string
}

interface UserInfo {
  orgId: string
}

interface AppDetailTrayProps {
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
  orgSettings?: OrganizationSettings | null
  shadowOrgId?: string | null
}

export function AppDetailTray({
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
  orgSettings,
  shadowOrgId,
}: AppDetailTrayProps) {
  if (!app) return null

  // Create userInfo from shadowOrgId
  const userInfo: UserInfo | null = shadowOrgId ? { orgId: shadowOrgId } : null

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
        <AppDetail
          app={app}
          onUpdateApp={onUpdateApp}
          onRemoveApp={(appId) => {
            onRemoveApp(appId)
            onClose()
          }}
          initialEditMode={isEditMode}
          orgSettings={orgSettings}
          userInfo={userInfo}
        />
      </div>
    </div>
  )
} 