import React, { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Plus, Trash2 } from "lucide-react"
import type { AppSKU } from "@/types/app"

// Simple UUID generator fallback
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

interface SKUTableProps {
  skus: AppSKU[]
  onSKUsChange: (skus: AppSKU[]) => void
  editMode: boolean
  contractRenewalDate?: string
  contractRenewalType?: string
  contractBillingFrequency?: string
}

export function SKUTable({ 
  skus, 
  onSKUsChange, 
  editMode, 
  contractRenewalDate,
  contractRenewalType,
  contractBillingFrequency 
}: SKUTableProps) {
  const handleAddSKU = () => {
    const newSKU: AppSKU = {
      id: generateUUID(),
      name: "",
      planLimit: "",
      licensesUsed: null,
      planReference: "",
      costPerUser: "",
      isDefault: skus.length === 0,
      overrideContractFields: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    onSKUsChange([...skus, newSKU])
  }

  const handleUpdateSKU = (skuId: string, updates: Partial<AppSKU>) => {
    const updatedSKUs = skus.map(sku => 
      sku.id === skuId 
        ? { ...sku, ...updates, updatedAt: new Date().toISOString() }
        : sku
    )
    onSKUsChange(updatedSKUs)
  }

  const handleRemoveSKU = (skuId: string) => {
    const skuToRemove = skus.find(sku => sku.id === skuId)
    if (skuToRemove?.isDefault && skus.length > 1) {
      const remainingSKUs = skus.filter(sku => sku.id !== skuId)
      remainingSKUs[0].isDefault = true
      onSKUsChange(remainingSKUs)
    } else {
      onSKUsChange(skus.filter(sku => sku.id !== skuId))
    }
  }

  const handleSetDefault = (skuId: string) => {
    const updatedSKUs = skus.map(sku => ({
      ...sku,
      isDefault: sku.id === skuId,
      updatedAt: new Date().toISOString()
    }))
    onSKUsChange(updatedSKUs)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-100 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-[140px]">SKU Notes</TableHead>
              <TableHead className="w-[110px]">Plan Limit</TableHead>
              <TableHead className="w-[110px]">Licenses Used</TableHead>
              <TableHead className="w-[130px]">Plan Reference</TableHead>
              <TableHead className="w-[130px]">Cost Per User</TableHead>
              <TableHead className="w-[130px]">Override Contract</TableHead>
              {editMode && skus.length > 1 && <TableHead className="w-[80px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {skus.map((sku) => (
              <React.Fragment key={sku.id}>
                <TableRow>
                  <TableCell>
                    {editMode ? (
                      <Input 
                        value={sku.name}
                        onChange={(e) => handleUpdateSKU(sku.id, { name: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      <span className="font-medium">{sku.name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editMode ? (
                      <Input 
                        value={sku.planLimit}
                        onChange={(e) => handleUpdateSKU(sku.id, { planLimit: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      sku.planLimit || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editMode ? (
                      <Input 
                        type="number"
                        value={sku.licensesUsed || ""}
                        onChange={(e) => handleUpdateSKU(sku.id, { 
                          licensesUsed: e.target.value ? parseInt(e.target.value) : null 
                        })}
                        className="h-8"
                      />
                    ) : (
                      sku.licensesUsed || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editMode ? (
                      <Input 
                        value={sku.planReference}
                        onChange={(e) => handleUpdateSKU(sku.id, { planReference: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      sku.planReference || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editMode ? (
                      <Input 
                        value={sku.costPerUser}
                        onChange={(e) => handleUpdateSKU(sku.id, { costPerUser: e.target.value })}
                        className="h-8"
                      />
                    ) : (
                      sku.costPerUser || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {editMode ? (
                      <Switch
                        checked={sku.overrideContractFields}
                        onCheckedChange={(checked) => handleUpdateSKU(sku.id, { 
                          overrideContractFields: checked,
                          // Clear override fields if disabling
                          ...(checked ? {} : {
                            renewalDate: undefined,
                            renewalType: undefined,
                            billingFrequency: undefined
                          })
                        })}
                      />
                    ) : (
                      sku.overrideContractFields ? "Yes" : "No"
                    )}
                  </TableCell>
                  {editMode && skus.length > 1 && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveSKU(sku.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
                
                {/* Contract Override Fields Row */}
                {sku.overrideContractFields && (
                  <TableRow className="bg-gray-50">
                    <TableCell colSpan={editMode && skus.length > 1 ? 7 : 6} className="p-4">
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-700">Contract Override Fields</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="text-xs text-gray-600">Renewal Date</label>
                            {editMode ? (
                              <Input
                                type="date"
                                value={sku.renewalDate || ""}
                                onChange={(e) => handleUpdateSKU(sku.id, { renewalDate: e.target.value })}
                                className="h-8 mt-1"
                              />
                            ) : (
                              <div className="text-sm">{sku.renewalDate || contractRenewalDate || "—"}</div>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Renewal Type</label>
                            {editMode ? (
                              <select
                                value={sku.renewalType || ""}
                                onChange={(e) => handleUpdateSKU(sku.id, { renewalType: e.target.value })}
                                className="w-full h-8 mt-1 px-2 border border-gray-300 rounded text-sm"
                              >
                                <option value="">Select type</option>
                                <option value="Auto Renewal">Auto Renewal</option>
                                <option value="Manual Renewal">Manual Renewal</option>
                                <option value="Perpetual Renewal">Perpetual Renewal</option>
                              </select>
                            ) : (
                              <div className="text-sm">{sku.renewalType || contractRenewalType || "—"}</div>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Billing Frequency</label>
                            {editMode ? (
                              <select
                                value={sku.billingFrequency || ""}
                                onChange={(e) => handleUpdateSKU(sku.id, { billingFrequency: e.target.value })}
                                className="w-full h-8 mt-1 px-2 border border-gray-300 rounded text-sm"
                              >
                                <option value="">Select frequency</option>
                                <option value="Annual Plan">Annual Plan</option>
                                <option value="Monthly Plan">Monthly Plan</option>
                                <option value="Quarterly">Quarterly</option>
                                <option value="Usage Based">Usage Based</option>
                                <option value="Other">Other</option>
                              </select>
                            ) : (
                              <div className="text-sm">{sku.billingFrequency || contractBillingFrequency || "—"}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {editMode && (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleAddSKU}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add SKU
        </Button>
      )}
    </div>
  )
}
