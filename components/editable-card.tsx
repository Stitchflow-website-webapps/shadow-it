"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Edit2, Check, X, Calendar as CalendarIcon, Upload, ExternalLink, FileText } from "lucide-react"
import { InfoIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn, formatCurrency, getLicenseUtilizationStatus } from "@/lib/utils"
import { uploadApi } from "@/lib/api"
import { CurrencySelector, getCurrencySymbol, parseCurrencyValue, formatCurrencyValue } from "@/components/currency-selector"
import type { App } from "@/types/app"
import { Badge } from "@/components/ui/badge"

interface FieldConfig {
  label: string
  value: string
  field: keyof App
  type: "input" | "select" | "textarea" | "currency" | "date" | "file-url"
  placeholder?: string
  options?: { value: string; label: string }[]
  tooltip?: string
  currency?: string
  disabled?: boolean
  disabledText?: string
}

interface UserInfo {
  orgId: string
}

interface EditableCardProps {
  title: string
  icon: React.ReactNode
  fields: FieldConfig[]
  onUpdate: (fields: Partial<App>) => void
  appName?: string
  isEditing?: boolean
  userInfo?: UserInfo | null
}

// Helper function to calculate days until renewal
const getDaysUntilRenewal = (renewalDate: string): number => {
  if (!renewalDate || renewalDate === "Not specified") return 0
  
  try {
    const today = new Date()
    const renewal = new Date(renewalDate)
    
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

export function EditableCard({ title, icon, fields, onUpdate, appName, isEditing, userInfo }: EditableCardProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false)
  
  // Use external isEditing prop when provided, otherwise use internal state
  const editMode = isEditing ?? internalIsEditing
  

  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({})
  const [fileUploadStates, setFileUploadStates] = useState<Record<string, boolean>>({})
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({})
  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({})
  // User info is now passed as prop instead of using useAuth

  // Initialize date picker states based on field values
  useEffect(() => {
    const initialDatePickerStates: Record<string, boolean> = {}
    const initialFileUploadStates: Record<string, boolean> = {}
    
    fields.forEach((field) => {
      if (field.type === "date" && field.value && field.value !== "Not specified") {
        // Enable calendar picker if we have a valid date value
        try {
          const date = new Date(field.value)
          if (!isNaN(date.getTime())) {
            initialDatePickerStates[field.field] = true
          }
        } catch {
          // If date parsing fails, default to false
          initialDatePickerStates[field.field] = false
        }
      }
      
      if (field.type === "file-url" && field.value && field.value !== "Not specified") {
        // Enable file upload mode if we have an uploaded file or URL
        try {
          const fileMetadata = JSON.parse(field.value)
          if (fileMetadata.type === 'uploaded_file') {
            initialFileUploadStates[field.field] = true
          }
        } catch {
          // If parsing fails, check if it's a URL
          if (field.value.startsWith('http')) {
            initialFileUploadStates[field.field] = true
          }
        }
      }
    })
    
    // Only update if we don't already have states for these fields
    setDatePickerStates(prev => {
      const newStates = { ...prev }
      Object.entries(initialDatePickerStates).forEach(([field, enabled]) => {
        if (!(field in prev)) {
          newStates[field] = enabled
        }
      })
      return newStates
    })
    
    setFileUploadStates(prev => {
      const newStates = { ...prev }
      Object.entries(initialFileUploadStates).forEach(([field, enabled]) => {
        if (!(field in prev)) {
          newStates[field] = enabled
        }
      })
      return newStates
    })
  }, [fields])

  const handleEdit = () => {
    // Only use internal edit state if no external state is provided
    if (isEditing == null) {
      setInternalIsEditing(true)
      // Initialize edited values with current values
      const initialValues: Record<string, string> = {}
      fields.forEach((field) => {
        initialValues[field.field] = field.value === "Not specified" ? "unset" : field.value
      })
      setEditedValues(initialValues)
    }
  }

  const handleSave = () => {
    // Only save if using internal edit state
    if (isEditing == null) {
      const updates: Record<string, any> = {}
      Object.entries(editedValues).forEach(([key, value]) => {
        // Convert "unset" back to empty string for storage, handle special types
        const processedValue = value === "unset" ? "" : value
        if (key === "licensesUsed") {
          updates[key] = processedValue === "" ? null : parseInt(processedValue, 10) || null
        } else {
          updates[key] = processedValue
        }
      })
      onUpdate(updates as Partial<App>)
      setInternalIsEditing(false)
      setEditedValues({})
    }
  }

  const handleCancel = () => {
    // Only cancel if using internal edit state
    if (isEditing == null) {
      setInternalIsEditing(false)
      setEditedValues({})
    }
  }

  const handleFieldChange = (field: string, value: string) => {
    if (isEditing != null) {
      // When using external edit state, notify parent immediately
      onUpdate({ [field]: value === "unset" ? "" : value })
    } else {
      // When using internal state, store locally
      setEditedValues((prev) => ({ ...prev, [field]: value }))
    }
  }

  const handleDatePickerToggle = (field: string, enabled: boolean) => {
    setDatePickerStates((prev) => ({ ...prev, [field]: enabled }))
  }

  const handleFileUploadToggle = (field: string, enabled: boolean) => {
    setFileUploadStates((prev) => ({ ...prev, [field]: enabled }))
    if (!enabled) {
      // Clear uploaded file when switching back to URL input
      setUploadedFiles((prev) => {
        const newFiles = { ...prev }
        delete newFiles[field]
        return newFiles
      })
    }
  }

  const handleFileUpload = async (field: string, file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Please upload only PDF files.')
      return
    }
    if (file.size > 10 * 1024 * 1024) { // 10MB in bytes
      alert('File size must be less than 10MB.')
      return
    }

    if (!userInfo?.orgId || !appName) {
      alert('Unable to upload file. Please try again.')
      return
    }

    try {
      setIsUploading((prev) => ({ ...prev, [field]: true }))
      
      // Upload file to Supabase storage via API
      const uploadResult = await uploadApi.uploadFile(file, userInfo.orgId, appName)
      
      // Store file metadata as JSON string in the field value
      const fileMetadata = {
        type: 'uploaded_file',
        filePath: uploadResult.filePath,
        fileName: uploadResult.fileName,
        url: uploadResult.url
      }
      
      // Set the field value to the file metadata
      handleFieldChange(field, JSON.stringify(fileMetadata))
      setUploadedFiles((prev) => ({ ...prev, [field]: file }))
    } catch (error) {
      console.error('Error uploading file:', error)
      alert('Failed to upload file. Please try again.')
    } finally {
      setIsUploading((prev) => ({ ...prev, [field]: false }))
    }
  }

  const handleViewFile = async (field: string) => {
    const fieldValue = fields.find(f => f.field === field)?.value
    
    if (!fieldValue || fieldValue === "Not specified") {
      return
    }
    
    try {
      // Check if it's an uploaded file with metadata
      const fileMetadata = JSON.parse(fieldValue)
      if (fileMetadata.type === 'uploaded_file' && fileMetadata.filePath) {
        // Get a fresh signed URL for the file
        const signedUrl = await uploadApi.getSignedUrl(fileMetadata.filePath)
        window.open(signedUrl, '_blank')
        return
      }
    } catch {
      // If parsing fails, treat as regular URL
    }
    
    // For regular URLs, just open them
    if (fieldValue.startsWith('http')) {
      window.open(fieldValue, '_blank')
    } else {
      // Check if we have a local file object
      const file = uploadedFiles[field]
      if (file) {
        const url = URL.createObjectURL(file)
        window.open(url, '_blank')
      }
    }
  }

  const handleRemoveFile = async (field: string) => {
    const currentValue = fields.find(f => f.field === field)?.value
    
    try {
      if (currentValue && currentValue !== "Not specified") {
        try {
          // Check if it's an uploaded file with metadata
          const fileMetadata = JSON.parse(currentValue)
          if (fileMetadata.type === 'uploaded_file' && fileMetadata.filePath) {
            // Delete using the file path
            await uploadApi.deleteFile(fileMetadata.filePath)
          }
        } catch {
          // If parsing fails, might be a legacy URL - try to delete it as URL
          if (currentValue.startsWith('http')) {
            // For legacy URLs, we'll skip deletion since we don't have the path
            console.log('Cannot delete legacy URL file:', currentValue)
          }
        }
      }
      
      setUploadedFiles((prev) => {
        const newFiles = { ...prev }
        delete newFiles[field]
        return newFiles
      })
      
      // Reset the field value and update the parent component immediately
      const updates: Record<string, any> = {}
      updates[field] = ""
      onUpdate(updates as Partial<App>)
    } catch (error) {
      console.error('Error removing file:', error)
      // Still proceed with removing from UI even if deletion fails
      setUploadedFiles((prev) => {
        const newFiles = { ...prev }
        delete newFiles[field]
        return newFiles
      })
      
      const updates: Record<string, any> = {}
      updates[field] = ""
      onUpdate(updates as Partial<App>)
    }
  }

  const renderField = (field: FieldConfig) => {
    // When using external isEditing, always use field.value (parent manages state)
    // When using internal state, use editedValues in edit mode
    const currentValue = isEditing != null 
      ? field.value 
      : (editMode ? editedValues[field.field] || "unset" : field.value)
    const isDatePickerEnabled = datePickerStates[field.field] || false



    if (editMode) {
      switch (field.type) {
        case "select":
          return (
            <div key={field.field} className="space-y-1">
              {/* <Label htmlFor={field.field}>{field.label}</Label> */}
              <Select
                value={currentValue === "Not specified" || currentValue === "" ? undefined : currentValue}
                onValueChange={(value) => handleFieldChange(field.field, value)}
                disabled={field.disabled}
              >
                <SelectTrigger id={field.field} className="w-full">
                  <SelectValue placeholder={field.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.disabled && field.disabledText && (
                <div className="mt-2">
                  <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800 font-normal">
                    {field.disabledText}
                  </Badge>
                </div>
              )}
            </div>
          )
        case "textarea":
          return (
            <Textarea
              value={currentValue === "unset" ? "" : currentValue}
              onChange={(e) => handleFieldChange(field.field, e.target.value)}
              placeholder={field.placeholder}
              rows={5}
              className="text-body mt-3 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 resize-none focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
            />
          )
        case "currency":
          const parsed = parseCurrencyValue(currentValue === "unset" ? "" : currentValue)
          return (
            <div className="mt-3 flex gap-2">
              <CurrencySelector
                value={parsed.currencyCode}
                onValueChange={(currencyCode) => {
                  const newSymbol = getCurrencySymbol(currencyCode)
                  const formattedValue = formatCurrencyValue(newSymbol, parsed.amount)
                  handleFieldChange(field.field, formattedValue)
                }}
                className="w-20 bg-white border-gray-100"
              />
              <Input
                value={parsed.amount}
                onChange={(e) => {
                  const formattedValue = formatCurrencyValue(parsed.symbol, e.target.value)
                  handleFieldChange(field.field, formattedValue)
                }}
                placeholder={field.placeholder}
                className="h-11 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
              />
            </div>
          )
        case "date":
          return (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Use calendar picker</span>
                <Switch
                  checked={isDatePickerEnabled}
                  onCheckedChange={(checked) => handleDatePickerToggle(field.field, checked)}
                />
              </div>
              
              {isDatePickerEnabled ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full h-11 justify-start text-left font-normal bg-white border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-200 rounded-lg shadow-sm",
                        !currentValue && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {(() => {
                        if (!currentValue || currentValue === "unset") {
                          return <span>Pick a date</span>
                        }
                        try {
                          const date = new Date(currentValue)
                          if (isNaN(date.getTime())) {
                            return <span>Pick a date</span>
                          }
                          return format(date, "PPP")
                        } catch {
                          return <span>Pick a date</span>
                        }
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-0 shadow-xl">
                    <Calendar
                      mode="single"
                      selected={(() => {
                        if (!currentValue || currentValue === "unset") return undefined
                        try {
                          const date = new Date(currentValue)
                          return isNaN(date.getTime()) ? undefined : date
                        } catch {
                          return undefined
                        }
                      })()}
                      onSelect={(date) => {
                        if (date) {
                          handleFieldChange(field.field, format(date, "yyyy-MM-dd"))
                        }
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <Input
                  value={currentValue === "unset" ? "" : currentValue}
                  onChange={(e) => handleFieldChange(field.field, e.target.value)}
                  placeholder={field.placeholder}
                  className="h-11 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
                />
              )}
            </div>
          )
        case "file-url":
          const isFileUploadEnabled = fileUploadStates[field.field] || false
          const uploadedFile = uploadedFiles[field.field]
          const isFileUploading = isUploading[field.field] || false
          
          return (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Upload PDF contract</span>
                <Switch
                  checked={isFileUploadEnabled}
                  onCheckedChange={(checked) => handleFileUploadToggle(field.field, checked)}
                  disabled={isFileUploading}
                />
              </div>
              
              {isFileUploadEnabled ? (
                <div className="space-y-2">
                  {(() => {
                    if (!currentValue || currentValue === "unset" || currentValue === "Not specified") {
                      return (
                        <div className={`border-2 border-dashed border-gray-200 rounded-lg p-4 text-center relative hover:border-gray-300 transition-colors ${isFileUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          {isFileUploading ? (
                            <div className="flex flex-col items-center">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mb-2" />
                              <div className="text-sm text-gray-600">Uploading...</div>
                            </div>
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                              <div className="text-sm text-gray-600 mb-2">
                                Drop PDF here or click to upload
                              </div>
                              <div className="text-xs text-gray-400">
                                Max 10MB, PDF only
                              </div>
                              <input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) {
                                    handleFileUpload(field.field, file)
                                  }
                                }}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                disabled={isFileUploading}
                              />
                            </>
                          )}
                        </div>
                      )
                    }
                    
                    // Check if it's uploaded file metadata
                    try {
                      const fileMetadata = JSON.parse(currentValue)
                      if (fileMetadata.type === 'uploaded_file') {
                        return (
                          <div className="p-3 border border-gray-100 rounded-lg bg-gray-50 space-y-3">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-gray-600" />
                              <span className="text-sm text-gray-700">
                                {fileMetadata.fileName || 'Uploaded contract'}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleViewFile(field.field)}
                                className="h-8 px-3 text-xs"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                View Details
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemoveFile(field.field)}
                                className="h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <X className="h-3 w-3 mr-1" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        )
                      }
                    } catch {
                      // Fall through to legacy URL handling
                    }
                    
                    // Handle legacy URLs or new URLs
                    if (currentValue.startsWith('http')) {
                      return (
                        <div className="p-3 border border-gray-100 rounded-lg bg-gray-50 space-y-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-gray-600" />
                            <span className="text-sm text-gray-700">
                              {uploadedFile ? uploadedFile.name : 'Uploaded contract'}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => window.open(currentValue, '_blank')}
                              className="h-8 px-3 text-xs"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveFile(field.field)}
                              className="h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      )
                    }
                    
                    return null;
                  })()}
                </div>
              ) : (
                <Input
                  value={currentValue === "unset" ? "" : currentValue}
                  onChange={(e) => handleFieldChange(field.field, e.target.value)}
                  placeholder={field.placeholder}
                  className="h-11 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
                />
              )}
            </div>
          )
        default:
          return (
            <Input
              value={currentValue === "unset" ? "" : currentValue}
              onChange={(e) => handleFieldChange(field.field, e.target.value)}
              placeholder={field.placeholder}
              className="h-11 mt-3 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
            />
          )
      }
    }

    // Read-only display with proper line break handling
    if (field.type === "textarea" && currentValue && currentValue !== "Not specified") {
      return (
        <div className="mt-3">
          <div className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50 whitespace-pre-wrap leading-relaxed">
            {currentValue}
          </div>
        </div>
      )
    }

    // Special handling for date fields in read-only mode
    if (field.type === "date" && currentValue && currentValue !== "Not specified") {
      // Try to parse the date and format it nicely
      try {
        const date = new Date(currentValue)
        if (!isNaN(date.getTime())) {
          // Special handling for renewal date field
          if (field.field === "renewalDate") {
            const daysUntil = getDaysUntilRenewal(currentValue)
            return (
              <div className="mt-3 space-y-3">
                <p className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50">
                  {format(date, "PPP")}
                </p>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-medium rounded-full px-2.5 py-1 text-xs border flex items-center gap-1.5 whitespace-nowrap",
                    daysUntil < 0
                      ? "bg-red-50 text-red-700 border-red-200"
                      : daysUntil <= 30
                      ? "bg-red-50 text-red-700 border-red-200"
                      : daysUntil <= 90
                      ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  )}
                >
                  {daysUntil < 0 ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="font-semibold">Overdue</span>
                        <span className="font-normal text-red-600">
                          ({Math.abs(daysUntil)} days ago)
                        </span>
                      </div>
                    </>
                  ) : daysUntil <= 30 ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="font-semibold">Due soon</span>
                        <span className="font-normal text-red-600">
                          ({daysUntil} days)
                        </span>
                      </div>
                    </>
                  ) : daysUntil <= 90 ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <span className="font-semibold">Upcoming</span>
                        <span className="font-normal text-yellow-600">
                          ({daysUntil} days)
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="font-semibold">On Track</span>
                        <span className="font-normal text-emerald-600">
                          ({daysUntil} days)
                        </span>
                      </div>
                    </>
                  )}
                </Badge>
              </div>
            )
          }
          
          // Regular date field display for non-renewal dates
          return (
            <div className="mt-3">
              <p className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50">
                {format(date, "PPP")}
              </p>
            </div>
          )
        }
      } catch {
        // If date parsing fails, fall back to displaying the raw value
      }
    }

    // Special handling for file-url fields in read-only mode
    if (field.type === "file-url" && currentValue && currentValue !== "Not specified") {
      // Check if it's uploaded file metadata
      try {
        const fileMetadata = JSON.parse(currentValue)
        if (fileMetadata.type === 'uploaded_file') {
          return (
            <div className="mt-3">
              <div className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-4 w-4 text-gray-600" />
                  <span>{fileMetadata.fileName || 'Uploaded contract'}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleViewFile(field.field)}
                    className="h-8 px-3 text-xs"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View Details
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveFile(field.field)}
                    className="h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      } catch {
        // Fall through to legacy URL handling
      }
      
      // Handle legacy URLs or manual URLs
      return (
        <div className="mt-3">
          <div className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50 flex items-center justify-between">
            <span>{currentValue}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => window.open(currentValue, '_blank')}
              className="h-6 px-2 text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open
            </Button>
          </div>
        </div>
      )
    }

    // Special handling for currency fields in read-only mode
    if (field.type === "currency" && currentValue && currentValue !== "Not specified") {
      return (
        <div className="mt-3">
          <p className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50">
            {formatCurrency(currentValue)}
          </p>
        </div>
      )
    }

    return (
      <div className="mt-3 space-y-2">
        <p className="text-body text-primary-text py-3 px-4 bg-gray-25 rounded-lg border border-gray-50">
          {currentValue}
        </p>
        {/* Show license utilization badge for licensesUsed field */}
        {field.field === 'licensesUsed' && (() => {
          // Find the plan limit field in the same card
          const planLimitField = fields.find(f => f.field === 'planLimit');
          const planLimitValue = planLimitField?.value || '';
          const licensesUsedValue = currentValue && currentValue !== "—" ? parseInt(currentValue, 10) : null;
          
          const utilizationStatus = getLicenseUtilizationStatus(licensesUsedValue, planLimitValue);
          return utilizationStatus ? (
            <div className={cn(
              "text-xs font-medium",
              utilizationStatus.status === 'Exceeded limit' ? "text-red-600" :
              utilizationStatus.status === 'Near capacity' ? "text-orange-600" :
              utilizationStatus.status === 'Growing usage' ? "text-yellow-600" :
              "text-emerald-600"
            )}>
              {utilizationStatus.status}
            </div>
          ) : null;
        })()}
      </div>
    )
  }

  return (
    <Card className="group relative hover:shadow-lg transition-all duration-300 bg-white border-gray-100 shadow-sm">
      <CardHeader className="pb-5">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gray-50 rounded-xl">
              {icon}
            </div>
            <span className="text-h5 font-medium text-primary-text">{title}</span>
          </div>
          {!editMode && isEditing == null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleEdit}
              className="h-9 w-9 p-0 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Edit2 className="h-4 w-4 text-gray-500" />
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-7 px-6 pb-6">
        {fields.map((field) => (
          <div key={field.field} className="space-y-2">
            <Label className="text-xs font-medium text-gray-600 uppercase tracking-wider flex items-center gap-2">
              {field.label}
              {field.tooltip && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <InfoIcon className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{field.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </Label>
            {renderField(field)}
          </div>
        ))}

        {editMode && isEditing == null && (
          <div className="flex gap-3 pt-6 border-t border-gray-100">
            <Button 
              size="sm" 
              onClick={handleSave} 
              variant="default"
              className="h-10 px-5 font-medium rounded-lg"
            >
              <Check className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={handleCancel} 
              className="h-10 px-5 border-gray-200 text-gray-700 hover:bg-gray-50 font-medium rounded-lg"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
