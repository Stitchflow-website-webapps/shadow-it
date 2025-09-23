"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
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
import { uploadApi, vendorFilesApi } from "@/lib/api"
import { CurrencySelector, getCurrencySymbol, parseCurrencyValue, formatCurrencyValue } from "@/components/currency-selector"
import type { App, VendorFile } from "@/types/app"
import { Badge } from "@/components/ui/badge"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"

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
  vendorFiles?: VendorFile[]
  onVendorFilesChange?: (files: VendorFile[]) => void
  customContent?: React.ReactNode
}

// Helper function to calculate days until renewal
const getDaysUntilRenewal = (renewalDate: string): number => {
  if (!renewalDate || renewalDate === "Not specified") return 0

  try {
    const today = new Date()
    let renewal: Date

    // Parse renewal date as local date to avoid timezone issues
    if (renewalDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // For YYYY-MM-DD format, parse as local date
      const [year, month, day] = renewalDate.split('-').map(Number)
      renewal = new Date(year, month - 1, day) // month is 0-indexed
    } else {
      renewal = new Date(renewalDate)
    }

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

// Helper function to parse dates with current year default
const parseSmartDate = (input: string): string => {
  if (!input || input.trim() === '') return input

  const trimmedInput = input.trim()
  const currentYear = new Date().getFullYear()
  
  // If it's already a complete YYYY-MM-DD format, return as is
  if (trimmedInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return trimmedInput
  }

  try {
    // Create a date object from the input
    let parsedDate = new Date(trimmedInput)
    
    // If the parsed date is valid but has year 2001 (browser default for missing year)
    // or any year before 2000, update it to current year
    if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() <= 2001) {
      parsedDate.setFullYear(currentYear)
    }
    
    // If we successfully parsed a date, return it in YYYY-MM-DD format
    if (!isNaN(parsedDate.getTime())) {
      return format(parsedDate, 'yyyy-MM-dd')
    }
  } catch (error) {
    // If parsing fails, try some common patterns
    
    // Handle month names (e.g., "sep", "september", "sep 15")
    const monthPatterns = [
      { pattern: /^(jan|january)\s*(\d{1,2})?$/i, month: 0 },
      { pattern: /^(feb|february)\s*(\d{1,2})?$/i, month: 1 },
      { pattern: /^(mar|march)\s*(\d{1,2})?$/i, month: 2 },
      { pattern: /^(apr|april)\s*(\d{1,2})?$/i, month: 3 },
      { pattern: /^(may)\s*(\d{1,2})?$/i, month: 4 },
      { pattern: /^(jun|june)\s*(\d{1,2})?$/i, month: 5 },
      { pattern: /^(jul|july)\s*(\d{1,2})?$/i, month: 6 },
      { pattern: /^(aug|august)\s*(\d{1,2})?$/i, month: 7 },
      { pattern: /^(sep|september)\s*(\d{1,2})?$/i, month: 8 },
      { pattern: /^(oct|october)\s*(\d{1,2})?$/i, month: 9 },
      { pattern: /^(nov|november)\s*(\d{1,2})?$/i, month: 10 },
      { pattern: /^(dec|december)\s*(\d{1,2})?$/i, month: 11 },
    ]
    
    for (const { pattern, month } of monthPatterns) {
      const match = trimmedInput.match(pattern)
      if (match) {
        const day = match[2] ? parseInt(match[2], 10) : 1
        if (day >= 1 && day <= 31) {
          const date = new Date(currentYear, month, day)
          return format(date, 'yyyy-MM-dd')
        }
      }
    }
    
    // Handle MM/DD or MM-DD patterns (default to current year)
    const mmddPattern = /^(\d{1,2})[\/\-](\d{1,2})$/
    const mmddMatch = trimmedInput.match(mmddPattern)
    if (mmddMatch) {
      const month = parseInt(mmddMatch[1], 10) - 1 // 0-indexed
      const day = parseInt(mmddMatch[2], 10)
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const date = new Date(currentYear, month, day)
        return format(date, 'yyyy-MM-dd')
      }
    }
  }
  
  // If all parsing attempts fail, return the original input
  return input
}

// Vendor Files Content Component
function VendorFilesContent({
  vendorFiles,
  onVendorFilesChange,
  isEditing,
  appName,
  userInfo
}: {
  vendorFiles: VendorFile[]
  onVendorFilesChange?: (files: VendorFile[]) => void
  isEditing: boolean
  appName: string
  userInfo?: UserInfo | null
}) {
  const [isUploading, setIsUploading] = useState(false)
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [pendingLabelFiles, setPendingLabelFiles] = useState<VendorFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [fileToRemove, setFileToRemove] = useState<VendorFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const maxFilesAllowed = 5
  const remainingSlots = maxFilesAllowed - vendorFiles.length

  const handleFileUpload = async (files: FileList) => {
    if (!files.length || !userInfo?.orgId) return

    const filesToUpload = Array.from(files).slice(0, remainingSlots)

    if (filesToUpload.length < files.length) {
      setError(`Only a maximum of 5 files can be uploaded.`)
    } else {
      setError(null)
    }

    setIsUploading(true)

    try {
      const uploadPromises = filesToUpload.map(async (file) => {
        const uploadResult = await uploadApi.uploadFile(file, userInfo.orgId, appName, 'vendor')

        const vendorFile: VendorFile = {
          id: crypto.randomUUID(),
          fileName: file.name,
          label: "", // Start with empty label - user will be prompted to add one
          filePath: uploadResult.filePath,
          uploadedAt: new Date().toISOString(),
          fileType: file.type,
          url: uploadResult.url
        }

        return vendorFile
      })

      const newFiles = await Promise.all(uploadPromises)
      const updatedFiles = [...vendorFiles, ...newFiles]
      onVendorFilesChange?.(updatedFiles)

      // Auto-prompt for label on the first uploaded file
      if (newFiles.length > 0) {
        setPendingLabelFiles(newFiles)
        setEditingLabelId(newFiles[0].id)
        setEditingLabel("")
      }

    } catch (error) {
      console.error('Error uploading files:', error)
      setError(error instanceof Error ? error.message : 'Failed to upload files')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemoveFile = (fileId: string) => {
    const file = vendorFiles.find(f => f.id === fileId)
    if (!file) return

    setFileToRemove(file)
    setShowRemoveDialog(true)
  }

  const confirmRemoveFile = async () => {
    if (!fileToRemove) return

    try {
      // Delete file from storage using the file path
      await uploadApi.deleteFile(fileToRemove.filePath)
    } catch (error) {
      console.error('Error deleting file from storage:', error)
      // Continue with UI removal even if storage deletion fails
      setError('File removed from list, but may still exist in storage')
    }

    // Remove file from local state
    const updatedFiles = vendorFiles.filter(f => f.id !== fileToRemove.id)
    onVendorFilesChange?.(updatedFiles)

    // Reset dialog state
    setShowRemoveDialog(false)
    setFileToRemove(null)
  }

  const handleStartEditLabel = (file: VendorFile) => {
    setEditingLabelId(file.id)
    setEditingLabel(file.label)
  }

  const handleSaveLabel = (fileId: string) => {
    if (!editingLabel.trim()) {
      setError('Label/note cannot be empty')
      return
    }

    const updatedFiles = vendorFiles.map(f =>
      f.id === fileId ? { ...f, label: editingLabel.trim() } : f
    )
    onVendorFilesChange?.(updatedFiles)

    // Check if there are more pending files that need labels
    const remainingPendingFiles = pendingLabelFiles.filter(f => f.id !== fileId && !f.label)
    if (remainingPendingFiles.length > 0) {
      // Move to next file that needs a label
      setEditingLabelId(remainingPendingFiles[0].id)
      setEditingLabel("")
      setPendingLabelFiles(remainingPendingFiles)
    } else {
      // All files have labels, clear editing state
      setEditingLabelId(null)
      setEditingLabel('')
      setPendingLabelFiles([])
    }
    setError(null)
  }

  const handleCancelEdit = () => {
    setEditingLabelId(null)
    setEditingLabel('')
    setPendingLabelFiles([])
  }

  const getFileTypeLabel = (fileType: string) => {
    const typeMap: { [key: string]: string } = {
      'application/pdf': 'PDF',
      'text/csv': 'CSV',
      'application/vnd.ms-excel': 'Excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'application/msword': 'Word',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word'
    }
    return typeMap[fileType] || 'File'
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Upload and manage vendor-related documents ({vendorFiles.length}/{maxFilesAllowed} files)
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* Upload Area */}
      {isEditing && remainingSlots > 0 && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
          <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 mb-2">
            Drag and drop files here, or click to browse
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Supports PDF, CSV, Excel (.xlsx, .xls), and Word (.docx, .doc) files
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="h-9"
          >
            {isUploading ? 'Uploading...' : 'Choose Files'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.csv,.xlsx,.xls,.docx,.doc"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            className="hidden"
            disabled={isUploading}
          />
        </div>
      )}

      {/* Files List */}
      {vendorFiles.length > 0 && (
        <div className="space-y-3">
          {vendorFiles.map((file) => (
            <div key={file.id} className="p-3 border border-gray-100 rounded-lg bg-gray-50 space-y-3">
              {/* File Info Row */}
              <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-600 flex-shrink-0" />
              <span className="text-sm text-gray-700 flex-1 min-w-0 truncate" title={file.fileName}>
                  {file.fileName}
                </span>
                <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded flex-shrink-0">
                  {getFileTypeLabel(file.fileType)}
                </span>
              </div>

              {/* Label/Note Row */}
              {editingLabelId === file.id ? (
                <div className="space-y-2">
                  <Input
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    placeholder="Enter label/note for this file"
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveLabel(file.id)
                      } else if (e.key === 'Escape') {
                        handleCancelEdit()
                      }
                    }}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleSaveLabel(file.id)}
                      className="h-8 px-3 text-xs"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelEdit}
                      className="h-8 px-3 text-xs"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Label Display */}
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Label: </span>
                    {file.label || 'No label added'}
                  </div>

                  {/* Action Buttons Row */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          // Get a fresh signed URL for the file
                          const signedUrl = await uploadApi.getSignedUrl(file.filePath)
                          window.open(signedUrl, '_blank')
                        } catch (error) {
                          console.error('Error getting signed URL:', error)
                          alert('Failed to open file. Please try again.')
                        }
                      }}
                      className="h-8 px-3 text-xs"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View Details
                    </Button>
                    {isEditing && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartEditLabel(file)}
                          className="h-8 px-3 text-xs"
                        >
                          <Edit2 className="h-3 w-3 mr-1" />
                          Edit Label
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveFile(file.id)}
                          className="h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {vendorFiles.length === 0 && !isEditing && (
        <div className="text-center py-8 text-gray-500">
          <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No vendor files uploaded</p>
        </div>
      )}

      {/* Remove File Confirmation Dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{fileToRemove?.fileName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveFile}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
            >
              Remove File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function EditableCard({ title, icon, fields, onUpdate, appName, isEditing, userInfo, vendorFiles, onVendorFilesChange, customContent }: EditableCardProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false)
  
  // Use external isEditing prop when provided, otherwise use internal state
  const editMode = isEditing ?? internalIsEditing
  

  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [datePickerStates, setDatePickerStates] = useState<Record<string, boolean>>({})
  const [fileUploadStates, setFileUploadStates] = useState<Record<string, boolean>>({})
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({})
  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({})
  const [showContractRemoveDialog, setShowContractRemoveDialog] = useState(false)
  const [contractFileToRemove, setContractFileToRemove] = useState<{field: string, fileName: string} | null>(null)
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
    // File size limit removed as requested

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

  const handleRemoveFile = (field: string) => {
    const currentValue = fields.find(f => f.field === field)?.value
    let fileName = 'this file'

    // Try to get the file name
    try {
      if (currentValue && currentValue !== "Not specified") {
        try {
          const fileMetadata = JSON.parse(currentValue)
          if (fileMetadata.type === 'uploaded_file' && fileMetadata.fileName) {
            fileName = fileMetadata.fileName
          }
        } catch {
          // If parsing fails, might be a URL
          if (currentValue.startsWith('http')) {
            fileName = currentValue.split('/').pop() || 'this file'
          }
        }
      }
    } catch {
      // Use default name
    }

    setContractFileToRemove({ field, fileName })
    setShowContractRemoveDialog(true)
  }

  const confirmRemoveContractFile = async () => {
    if (!contractFileToRemove) return

    const { field } = contractFileToRemove
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

    // Reset dialog state
    setShowContractRemoveDialog(false)
    setContractFileToRemove(null)
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
                  <Badge 
                    variant="outline" 
                    className="bg-amber-50 border-amber-200 text-amber-800 font-normal cursor-pointer hover:bg-amber-100 transition-colors"
                    onClick={() => {
                      // Navigate to IdP settings page
                      if (typeof window !== 'undefined') {
                        window.location.href = '/settings?view=authentication';
                      }
                    }}
                  >
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
          const isDatePickerEnabled = datePickerStates[field.field] || false;
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
                <Calendar
                  selected={currentValue && currentValue !== "unset" ? (() => {
                    // Parse date as local date to avoid timezone issues
                    if (currentValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                      const [year, month, day] = currentValue.split('-').map(Number)
                      return new Date(year, month - 1, day) // month is 0-indexed
                    }
                    return new Date(currentValue)
                  })() : null}
                  onChange={(date: Date | null) => {
                    if (date) {
                      handleFieldChange(field.field, format(date, 'yyyy-MM-dd'));
                    } else {
                      handleFieldChange(field.field, '');
                    }
                  }}
                  placeholderText={field.placeholder}
                />
              ) : (
                <Input
                  value={currentValue === "unset" ? "" : currentValue}
                  onChange={(e) => handleFieldChange(field.field, e.target.value)}
                  onBlur={(e) => {
                    // Apply smart date parsing when user finishes typing
                    const smartParsedDate = parseSmartDate(e.target.value)
                    if (smartParsedDate !== e.target.value) {
                      handleFieldChange(field.field, smartParsedDate)
                    }
                  }}
                  placeholder={field.placeholder}
                  className="h-11 bg-white border-gray-100 text-primary-text placeholder:text-gray-400 focus:border-bg-dark focus:ring-2 focus:ring-gray-200 transition-all"
                />
              )}
            </div>
          );
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
                                PDF files only
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
                      // Try to extract filename from URL
                      const getFilenameFromUrl = (url: string) => {
                        try {
                          const urlObj = new URL(url)
                          const pathname = urlObj.pathname
                          const filename = pathname.split('/').pop()
                          return filename && filename.includes('.') ? filename : 'Contract document'
                        } catch {
                          return 'Contract document'
                        }
                      }

                      return (
                        <div className="p-3 border border-gray-100 rounded-lg bg-gray-50 space-y-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-gray-600" />
                            <span className="text-sm text-gray-700">
                              {uploadedFile ? uploadedFile.name : getFilenameFromUrl(currentValue)}
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
        let date: Date
        // Parse date as local date to avoid timezone issues
        if (currentValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // For YYYY-MM-DD format, parse as local date
          const [year, month, day] = currentValue.split('-').map(Number)
          date = new Date(year, month - 1, day) // month is 0-indexed
        } else {
          date = new Date(currentValue)
        }

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
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        <span className="font-semibold">Overdue</span>
                        <span className="font-normal text-red-600">
                          ({Math.abs(daysUntil)} days ago)
                        </span>
                      </div>
                    </>
                  ) : daysUntil <= 30 ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        <span className="font-semibold">Due soon</span>
                        <span className="font-normal text-red-600">
                          ({daysUntil} days)
                        </span>
                      </div>
                    </>
                  ) : daysUntil <= 90 ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
                        <span className="font-semibold">Upcoming</span>
                        <span className="font-normal text-yellow-600">
                          ({daysUntil} days)
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
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
              onClick={() => handleViewFile(field.field)}
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
            <div className="flex items-center gap-1">
              <div className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                utilizationStatus.status === 'Exceeded limit' ? "bg-red-500" :
                utilizationStatus.status === 'At capacity' ? "bg-red-500" :
                utilizationStatus.status === 'Near capacity' ? "bg-orange-500" :
                utilizationStatus.status === 'Growing usage' ? "bg-yellow-500" :
                "bg-emerald-500"
              )} />
              <span className={cn(
                "text-xs font-medium",
                utilizationStatus.status === 'Exceeded limit' ? "text-red-600" :
                utilizationStatus.status === 'At capacity' ? "text-red-600" :
                utilizationStatus.status === 'Near capacity' ? "text-orange-600" :
                utilizationStatus.status === 'Growing usage' ? "text-yellow-600" :
                "text-emerald-600"
              )}>
                {utilizationStatus.status}
              </span>
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
        {customContent ? (
          customContent
        ) : title === "Vendor Files and Notes" ? (
          <VendorFilesContent
            vendorFiles={vendorFiles || []}
            onVendorFilesChange={onVendorFilesChange}
            isEditing={editMode}
            appName={appName || ''}
            userInfo={userInfo}
          />
        ) : (
          fields.map((field) => (
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
          ))
        )}

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

      {/* Remove Contract File Confirmation Dialog */}
      <AlertDialog open={showContractRemoveDialog} onOpenChange={setShowContractRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{contractFileToRemove?.fileName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveContractFile}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
            >
              Remove File
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
