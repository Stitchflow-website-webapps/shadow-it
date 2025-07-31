import { useState } from "react"
import { Plus, Trash2, Search, Calendar as CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { App } from "@/types/app"

export interface FilterCondition {
  id: string
  field: string
  operator: string
  value: string
  valueEnd?: string // For range operations like "between"
  connector: 'AND' | 'OR'
}

interface AppFiltersProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  filters: FilterCondition[]
  onFiltersChange: (filters: FilterCondition[]) => void
  totalApps: number
  filteredCount: number
}

const FILTER_FIELDS = [
  { value: 'name', label: 'App Name', type: 'text' },
  { value: 'department', label: 'Department', type: 'text' },
  { value: 'owner', label: 'Owner', type: 'text' },
  { value: 'ssoEnforced', label: 'SSO Enforced', type: 'select', options: ['Yes', 'No'] },
  { value: 'deprovisioning', label: 'Deprovisioning', type: 'select', options: ['Okta SCIM', 'Azure AD federation', 'OneLogin SCIM', 'JumpCloud federation', 'Google federation', 'Workflow', 'Manual', 'Unknown'] },
  { value: 'managedStatus', label: 'Managed Status', type: 'select', options: ['Managed', 'Unmanaged', 'Newly discovered'] },
  { value: 'stitchflowStatus', label: 'Stitchflow Status', type: 'select', options: ['Yes - API', 'Yes - CSV Sync', 'Not connected'] },
  { value: 'appTier', label: 'App Tier', type: 'select', options: ['Tier 1', 'Tier 2', 'Tier 3'] },
  { value: 'appPlan', label: 'App Plan', type: 'select', options: ['Annual Plan', 'Monthly Plan', 'N/A', 'Other'] },
  { value: 'planLimit', label: 'Plan Limit', type: 'number' },
  { value: 'licensesUsed', label: 'Licenses Used', type: 'number' },
  { value: 'costPerUser', label: 'Cost Per User', type: 'number' },
  { value: 'renewalDate', label: 'Renewal Date', type: 'date' },
  { value: 'comment', label: 'Access Policy & Notes', type: 'text' },
  { value: 'usageDescription', label: "App Usage", type: 'text' },
]

const getOperatorOptions = (fieldType: string) => {
  switch (fieldType) {
    case 'text':
      return [
        { value: 'contains', label: 'contains' },
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
        { value: 'starts_with', label: 'starts with' },
        { value: 'ends_with', label: 'ends with' },
      ]
    case 'select':
      return [
        { value: 'is', label: 'is' },
        { value: 'is_not', label: 'is not' },
      ]
    case 'number':
      return [
        { value: 'is', label: 'is' },
        { value: 'greater_than', label: 'is greater than' },
        { value: 'less_than', label: 'is less than' },
        { value: 'between', label: 'is between' },
      ]
    case 'date':
      return [
        { value: 'is_before', label: 'is before' },
        { value: 'is_after', label: 'is after' },
        { value: 'is_on_or_before', label: 'is on or before' },
        { value: 'is_on_or_after', label: 'is on or after' },
        { value: 'is_between', label: 'is between' },
      ]
    default:
      return [{ value: 'contains', label: 'contains' }]
  }
}

export function AppFilters({ 
  searchQuery, 
  onSearchChange, 
  filters, 
  onFiltersChange,
  totalApps,
  filteredCount 
}: AppFiltersProps) {
  const addFilter = () => {
    const newFilter: FilterCondition = {
      id: crypto.randomUUID(),
      field: 'name',
      operator: 'contains',
      value: '',
      connector: 'AND'
    }
    onFiltersChange([...filters, newFilter])
  }

  const removeFilter = (id: string) => {
    onFiltersChange(filters.filter(f => f.id !== id))
  }

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    onFiltersChange(filters.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  const clearAllFilters = () => {
    onFiltersChange([])
    onSearchChange('')
  }

  const getFieldType = (fieldValue: string) => {
    return FILTER_FIELDS.find(f => f.value === fieldValue)?.type || 'text'
  }

  const getFieldOptions = (fieldValue: string) => {
    return FILTER_FIELDS.find(f => f.value === fieldValue)?.options || []
  }

  return (
    <div className="space-y-4">
      {/* Search and Filter Controls Row */}
      <div className="flex items-center gap-4">
        {/* Reduced Search Bar */}
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input 
            placeholder="Search across all fields..." 
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-white border-gray-300 text-primary-text placeholder:text-gray-500 focus:border-gray-400 focus:ring-0 shadow-sm transition-all" 
          />
        </div>

        {/* Filter Actions */}
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={addFilter}
            className="text-gray-600 border-gray-300 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Filter
          </Button>

          {filters.length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllFilters}
              className="text-gray-500 hover:text-gray-700"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear All Filters
            </Button>
          )}
        </div>

        {/* Results Count */}
        {(searchQuery || filters.length > 0) && (
          <div className="text-sm text-gray-500 ml-auto">
            {filteredCount} of {totalApps} apps
          </div>
        )}
      </div>

      {/* Filter Conditions */}
      {filters.length > 0 && (
        <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
          {filters.map((filter, index) => {
            const fieldConfig = FILTER_FIELDS.find(f => f.value === filter.field)
            const fieldType = fieldConfig?.type || 'text'
            const operatorOptions = getOperatorOptions(fieldType)
            const fieldOptions = getFieldOptions(filter.field)

            return (
              <div key={filter.id} className="space-y-2">
                {/* Connector (And/Or) - only show for non-first filters */}
                {index > 0 && (
                  <div className="flex justify-center">
                    <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                      <button
                        onClick={() => updateFilter(filter.id, { connector: 'AND' })}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          filter.connector === 'AND' 
                            ? 'bg-gray-100 text-gray-900 border-r border-gray-300' 
                            : 'text-gray-600 hover:bg-gray-50 border-r border-gray-300'
                        }`}
                      >
                        And
                      </button>
                      <button
                        onClick={() => updateFilter(filter.id, { connector: 'OR' })}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          filter.connector === 'OR' 
                            ? 'bg-gray-100 text-gray-900' 
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        Or
                      </button>
                    </div>
                  </div>
                )}

                {/* Filter Row */}
                <div className="flex items-center gap-3">
                  {/* Field Selector */}
                  <Select 
                    value={filter.field} 
                    onValueChange={(value) => {
                      const newFieldType = getFieldType(value)
                      const newOperators = getOperatorOptions(newFieldType)
                      updateFilter(filter.id, { 
                        field: value, 
                        operator: newOperators[0]?.value || 'contains',
                        value: '' 
                      })
                    }}
                  >
                    <SelectTrigger className="w-48 bg-white border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_FIELDS.map(field => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Operator Selector */}
                  <Select 
                    value={filter.operator} 
                    onValueChange={(value) => updateFilter(filter.id, { 
                      operator: value, 
                      value: '', 
                      valueEnd: undefined 
                    })}
                  >
                    <SelectTrigger className="w-40 bg-white border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operatorOptions.map(op => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Value Input */}
                  {fieldType === 'select' ? (
                    <Select 
                      value={filter.value} 
                      onValueChange={(value) => updateFilter(filter.id, { value })}
                    >
                      <SelectTrigger className="flex-1 bg-white border-gray-300">
                        <SelectValue placeholder="Select value..." />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldOptions.map(option => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : filter.operator === 'between' || filter.operator === 'is_between' ? (
                    // Range inputs for "between" operations
                    <div className="flex-1 flex items-center gap-2">
                      {fieldType === 'date' ? (
                        <>
                          {/* From Date Picker */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "flex-1 justify-start text-left font-normal bg-white border-gray-300",
                                  !filter.value && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                 {filter.value ? (() => {
                                   try {
                                     return format(new Date(filter.value), "PPP")
                                   } catch {
                                     return filter.value
                                   }
                                 })() : <span>From date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={filter.value ? (() => {
                                  try {
                                    const date = new Date(filter.value)
                                    return !isNaN(date.getTime()) ? date : undefined
                                  } catch {
                                    return undefined
                                  }
                                })() : undefined}
                                onSelect={(date) => {
                                  if (date) {
                                    updateFilter(filter.id, { value: format(date, "yyyy-MM-dd") })
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          
                          <span className="text-gray-500 text-sm">to</span>
                          
                          {/* To Date Picker */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "flex-1 justify-start text-left font-normal bg-white border-gray-300",
                                  !filter.valueEnd && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                                 {filter.valueEnd ? (() => {
                                   try {
                                     return format(new Date(filter.valueEnd), "PPP")
                                   } catch {
                                     return filter.valueEnd
                                   }
                                 })() : <span>To date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={filter.valueEnd ? (() => {
                                  try {
                                    const date = new Date(filter.valueEnd)
                                    return !isNaN(date.getTime()) ? date : undefined
                                  } catch {
                                    return undefined
                                  }
                                })() : undefined}
                                onSelect={(date) => {
                                  if (date) {
                                    updateFilter(filter.id, { valueEnd: format(date, "yyyy-MM-dd") })
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </>
                      ) : (
                        <>
                          <Input
                            type={fieldType === 'number' ? 'number' : 'text'}
                            placeholder="From"
                            value={filter.value}
                            onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                            className="flex-1 bg-white border-gray-300"
                          />
                          <span className="text-gray-500 text-sm">to</span>
                          <Input
                            type={fieldType === 'number' ? 'number' : 'text'}
                            placeholder="To"
                            value={filter.valueEnd || ''}
                            onChange={(e) => updateFilter(filter.id, { valueEnd: e.target.value })}
                            className="flex-1 bg-white border-gray-300"
                          />
                        </>
                      )}
                    </div>
                  ) : fieldType === 'date' ? (
                    // Single date picker
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "flex-1 justify-start text-left font-normal bg-white border-gray-300",
                            !filter.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                                                     {filter.value ? (() => {
                             try {
                               return format(new Date(filter.value), "PPP")
                             } catch {
                               return filter.value
                             }
                           })() : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={filter.value ? (() => {
                            try {
                              const date = new Date(filter.value)
                              return !isNaN(date.getTime()) ? date : undefined
                            } catch {
                              return undefined
                            }
                          })() : undefined}
                          onSelect={(date) => {
                            if (date) {
                              updateFilter(filter.id, { value: format(date, "yyyy-MM-dd") })
                            }
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Input
                      type={fieldType === 'number' ? 'number' : 'text'}
                      placeholder={`Enter ${fieldConfig?.label.toLowerCase()}...`}
                      value={filter.value}
                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      className="flex-1 bg-white border-gray-300"
                    />
                  )}

                  {/* Remove Button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFilter(filter.id)}
                    className="text-gray-400 hover:text-gray-600 px-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
} 