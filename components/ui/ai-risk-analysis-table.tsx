"use client"

import React, { useState, useMemo } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, AlertTriangle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface AIRiskData {
  appName: string
  category: string
  scopeRisk: string
  users: number
  rawAppRiskScore: number
  finalAppRiskScore: number
  blastRadius: number
  actionBucket?: string
  adoptionPercent?: number
  orgThresholds?: {
    high: number
    medium: number
    maxUsers: number
  }
}

interface OrgSettings {
  bucketWeights: {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
  };
  aiMultipliers: {
    native: Record<string, number>;
    partial: Record<string, number>;
    none: Record<string, number>;
  };
  scopeMultipliers: {
    high: Record<string, number>;
    medium: Record<string, number>;
    low: Record<string, number>;
  };
}

interface AIRiskAnalysisTableProps {
  data: AIRiskData[]
  highlightTopRows?: number
  highlightColor?: string
  className?: string
  orgSettings: OrgSettings
  onAppClick?: (appName: string) => void
}

export function AIRiskAnalysisTable({
  data,
  highlightTopRows = 5,
  className = "",
  orgSettings,
  onAppClick
}: AIRiskAnalysisTableProps) {
  const [sortKey, setSortKey] = useState<keyof AIRiskData>("finalAppRiskScore")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  // Action bucket calculation functions
  const calculateRiskPercentile = (score: number, riskScores: number[]): number => {
    const sortedScores = [...riskScores].sort((a, b) => b - a);
    const p75 = sortedScores[Math.floor(sortedScores.length * 0.25)] || 0;
    const p50 = sortedScores[Math.floor(sortedScores.length * 0.5)] || 0;

    if (score >= p75) return 90;
    if (score >= p50) return 75;
    return 25;
  };

  const calculateActionBucket = (app: AIRiskData, orgMetrics: any): string => {
    const { finalAppRiskScore, users, category } = app;

    // Calculate risk percentiles
    const riskPercentile = calculateRiskPercentile(finalAppRiskScore, orgMetrics.allRiskScores);

    // Organization-specific adoption thresholds based on actual user distribution
    const isHighAdoption = users >= orgMetrics.highAdoptionThreshold;
    const isMediumAdoption = users >= orgMetrics.mediumAdoptionThreshold;

    // Risk thresholds with minimum absolute scores
    const isHighRisk = riskPercentile >= 75 && finalAppRiskScore > 5.0;
    const isMediumRisk = riskPercentile >= 50 && finalAppRiskScore > 2.0;

    // GenAI consideration
    const isGenAINative = category === 'GenAI native';

    // Decision matrix
    if (isHighAdoption && isHighRisk) {
      return "Enable & Protect";
    }

    if ((!isMediumAdoption && isHighRisk) || (isGenAINative && finalAppRiskScore > 3.0)) {
      return "Strategic Watchlist";
    }

    if (isHighAdoption && (isMediumRisk || (category === 'GenAI partial' && finalAppRiskScore > 2.0))) {
      return "Scale Safely";
    }

    if (isMediumRisk || (users >= orgMetrics.lowAdoptionThreshold && finalAppRiskScore > 1.5)) {
      return "Monitor (Moderate)";
    }

    return "Monitor (Low Priority)";
  };

  // Enhanced data with action buckets
  const enhancedData = useMemo(() => {
    if (data.length === 0) return data;

    // Calculate organization metrics for percentiles and adoption thresholds
    const totalUsers = data.reduce((sum, app) => sum + app.users, 0);
    const allRiskScores = data.map(app => app.finalAppRiskScore);
    const allUserCounts = data.map(app => app.users).sort((a, b) => b - a); // Descending order

    // Calculate organization-specific adoption thresholds based on user distribution
    const maxUsers = allUserCounts[0] || 0;
    const appsWithUsers = allUserCounts.filter(count => count > 0);
    const avgUsers = appsWithUsers.length > 0 ? appsWithUsers.reduce((sum, count) => sum + count, 0) / appsWithUsers.length : 0;

    // Adaptive thresholds based on organization's actual usage patterns
    const highAdoptionThreshold = Math.max(
      Math.ceil(maxUsers * 0.6), // Top 60% of highest usage
      Math.ceil(avgUsers * 1.5),  // 1.5x average usage
      5 // Minimum threshold of 5 users
    );

    const mediumAdoptionThreshold = Math.max(
      Math.ceil(maxUsers * 0.25), // Top 25% of highest usage
      Math.ceil(avgUsers * 0.75),  // 75% of average usage
      2 // Minimum threshold of 2 users
    );

    const lowAdoptionThreshold = Math.max(1, Math.ceil(avgUsers * 0.25)); // 25% of average

    const orgMetrics = {
      totalUsers,
      allRiskScores,
      highAdoptionThreshold,
      mediumAdoptionThreshold,
      lowAdoptionThreshold,
      maxUsers,
      avgUsers
    };

    // Add action bucket to each app
    return data.map(app => ({
      ...app,
      actionBucket: calculateActionBucket(app, orgMetrics),
      adoptionPercent: totalUsers > 0 ? (app.users / totalUsers) * 100 : 0,
      // Add threshold info for tooltips
      orgThresholds: {
        high: orgMetrics.highAdoptionThreshold,
        medium: orgMetrics.mediumAdoptionThreshold,
        maxUsers: orgMetrics.maxUsers
      }
    }));
  }, [data]);

  // Sort the enhanced data
  const sortedData = useMemo(() => {
    if (!sortKey || enhancedData.length === 0) return enhancedData

    return [...enhancedData].sort((a, b) => {
      const valueA = a[sortKey]
      const valueB = b[sortKey]

      // Handle numeric comparison
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortDirection === "asc" ? valueA - valueB : valueB - valueA
      }

      // String comparison
      const stringA = String(valueA).toLowerCase()
      const stringB = String(valueB).toLowerCase()

      if (sortDirection === "asc") {
        return stringA.localeCompare(stringB)
      } else {
        return stringB.localeCompare(stringA)
      }
    })
  }, [enhancedData, sortKey, sortDirection])

  // Handle sorting
  const handleSort = (key: keyof AIRiskData) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("desc")
    }
  }

  // Get sort icon
  const getSortIcon = (key: keyof AIRiskData) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Render sortable header
  const getSortableHeader = (label: string, key: keyof AIRiskData, className: string = "") => {
    return (
      <TableHead 
        className={`cursor-pointer bg-transparent ${className}`}
        onClick={() => handleSort(key)}
      >
        <div className="flex items-center">
          {label}
          {getSortIcon(key)}
        </div>
      </TableHead>
    )
  }

  // Format cell value for display
  const formatCellValue = (value: any, type: 'number' | 'string' = 'string'): string => {
    if (type === 'number' && typeof value === 'number') {
      return value % 1 === 0 ? value.toString() : value.toFixed(1)
    }
    return String(value)
  }

  // Category Badge Component (matching project patterns)
  const CategoryBadge = ({ category }: { category: string }) => {
    const getCategoryBadgeColor = (category: string) => {
      if (category.toLowerCase().includes('native')) {
        return 'bg-red-100 text-red-600'
      } else if (category.toLowerCase().includes('partial')) {
        return 'bg-yellow-100 text-yellow-600'
      }
      return 'bg-gray-100 text-gray-600'
    }

    const truncateText = (text: string, maxLength: number = 15) => {
      if (text.length > maxLength) {
        return text.substring(0, maxLength) + "..."
      }
      return text
    }

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryBadgeColor(category)} overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]`}
            >
              {truncateText(category, 15)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="p-2 bg-gray-900 text-white rounded-md shadow-lg">
            <p className="text-xs">{category}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Risk Badge Component (matching project patterns)
  const RiskBadge = ({ level }: { level: string }) => {
    const normalizedLevel = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()

    const iconMap: Record<string, React.JSX.Element> = {
      Low: <CheckCircle className="h-4 w-4 mr-1 text-green-700" />,
      Medium: <AlertTriangle className="h-4 w-4 mr-1 text-yellow-700" />,
      High: <AlertTriangle className="h-4 w-4 mr-1 text-pink-700" />
    }

    const colorMap: Record<string, string> = {
      Low: "text-green-700 bg-green-50",
      Medium: "text-yellow-700 bg-yellow-50",
      High: "text-pink-700 bg-pink-50"
    }

    return (
      <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${colorMap[normalizedLevel] || colorMap.Low}`}>
        {iconMap[normalizedLevel] || iconMap.Low}
        <span>{normalizedLevel}</span>
      </div>
    )
  }

  // Action Badge Component
  const ActionBadge = ({ bucket }: { bucket: string }) => {
    const colorMap: Record<string, string> = {
      "Enable & Protect": "text-black bg-white border-red-300",
      "Strategic Watchlist": "text-black bg-white border-orange-300",
      "Scale Safely": "text-black bg-white border-blue-300",
      "Monitor (Moderate)": "text-black bg-white border-yellow-300",
      "Monitor (Low Priority)": "text-black bg-white border-gray-300"
    };

    const priorityMap: Record<string, string> = {
      "Enable & Protect": "🔴",
      "Strategic Watchlist": "🟡",
      "Scale Safely": "🟢",
      "Monitor (Moderate)": "🔵",
      "Monitor (Low Priority)": "⚪"
    };

    return (
      <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-normal border ${colorMap[bucket] || colorMap["Monitor (Low Priority)"]}`}>
        <span>{priorityMap[bucket]}</span>
        <span>{bucket}</span>
      </div>
    );
  };

  // Get bucket explanation for tooltip
  const getBucketExplanation = (bucket: string): string => {
    const explanations: Record<string, string> = {
      "Enable & Protect": "Business-critical, huge blast-radius",
      "Strategic Watchlist": "Risky fringe, must watch",
      "Scale Safely": "Workhorse apps, need guardrails",
      "Monitor (Moderate)": "Niche tools, track quietly",
      "Monitor (Low Priority)": "Harmless long-tail apps"
    };
    return explanations[bucket] || "Standard monitoring required";
  };

  // Get action suggestions for tooltip
  const getActionSuggestions = (bucket: string): string[] => {
    const suggestions: Record<string, string[]> = {
      "Enable & Protect": [
        "Enforce SSO/SCIM everywhere",
        "Add usage guard-rails",
        "Continuous monitoring"
      ],
      "Strategic Watchlist": [
        "Isolate data if needed",
        "Auto-expire inactive accounts",
        "Keep with controls or deprecate"
      ],
      "Scale Safely": [
        "Add governance before growth",
        "Training for new users",
        "Usage guidelines & policies"
      ],
      "Monitor (Moderate)": [
        "Regular usage review",
        "Basic security controls",
        "Quarterly check-ins"
      ],
      "Monitor (Low Priority)": [
        "Annual review",
        "Basic monitoring",
        "No immediate action needed"
      ]
    };

    return suggestions[bucket] || suggestions["Monitor (Low Priority)"];
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header section matching project patterns */}
      <div className="flex justify-between items-center mt-[-4px]">
        <div>
          <p className="text-lg font-medium text-gray-800">
            AI Risk Analysis Results - {data.length} applications analyzed
          </p>
        </div>
      </div>

      {/* Main card container matching project patterns */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-6">
          {/* Sort info section */}
          <div className="mb-4">
            <Label className="text-sm font-medium text-gray-700">
              Sorted by {sortKey === 'blastRadius' ? 'Blast Radius' :
                        sortKey === 'appName' ? 'App Name' :
                        sortKey === 'scopeRisk' ? 'Scope Risk' :
                        sortKey === 'rawAppRiskScore' ? 'Raw App Risk Score' :
                        sortKey === 'finalAppRiskScore' ? 'Final App Risk Score' :
                        sortKey === 'users' ? 'Users' :
                        sortKey === 'category' ? 'Category' :
                        sortKey === 'actionBucket' ? 'Recommended Action' : sortKey}
              ({sortDirection === 'asc' ? 'ascending' : 'descending'})
            </Label>
          </div>

          {/* Table container matching project patterns */}
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              {data.length > 0 ? (
                <Table className="w-full min-w-fit">
                  <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                    <TableRow className="border-b border-gray-100">
                      {getSortableHeader("Application", "appName", "rounded-tl-lg")}
                      {getSortableHeader("Category", "category")}
                      {getSortableHeader("Scope Risk", "scopeRisk", "text-center")}
                      {getSortableHeader("Users", "users", "text-center")}
                      {getSortableHeader("Raw App Risk Score", "rawAppRiskScore", "text-center")}
                      {getSortableHeader("Final App Risk Score", "finalAppRiskScore", "text-center")}
                      {getSortableHeader("Blast Radius", "blastRadius", "text-center")}
                      {getSortableHeader("Recommended Action", "actionBucket", "text-center rounded-tr-lg font-semibold")}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData.map((row, index) => (
                      <TableRow
                        key={index}
                        className={`${index % 2 === 0 ? "bg-muted/10" : ""} ${
                          index === sortedData.length - 1 ? "last-row" : ""
                        } ${highlightTopRows > 0 && index < highlightTopRows ? "bg-[#F7F5F2]" : ""}`}
                      >
                        {/* App Name */}
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div 
                                  className="font-medium cursor-pointer hover:text-primary transition-colors truncate max-w-[120px]"
                                  onClick={() => onAppClick?.(row.appName)}
                                >
                                  {row.appName.length > 15 ? row.appName.substring(0, 15) + "..." : row.appName}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="p-2">
                                <p className="text-sm">{row.appName}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Category */}
                        <TableCell>
                          <div 
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => onAppClick?.(row.appName)}
                          >
                            <CategoryBadge category={row.category} />
                          </div>
                        </TableCell>
                        
                        {/* Scope Risk */}
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div 
                                  className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => onAppClick?.(row.appName)}
                                >
                                  <RiskBadge level={row.scopeRisk} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Scope Risk Level: {row.scopeRisk}</p>
                                <p className="text-xs text-gray-500 mt-1">Click to view app details</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Users */}
                        <TableCell className="text-center">
                          <div 
                            className="font-medium text-gray-900 cursor-pointer hover:text-primary transition-colors"
                            onClick={() => onAppClick?.(row.appName)}
                          >
                            {formatCellValue(row.users, 'number')}
                          </div>
                        </TableCell>
                        
                        {/* Raw App Risk Score */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div 
                                  className="font-medium text-gray-900 cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => onAppClick?.(row.appName)}
                                >
                                  {formatCellValue(row.rawAppRiskScore, 'number')}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Base risk score before amplification factors</p>
                                <p className="text-xs text-gray-500 mt-1">Click to view app details</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Final App Risk Score */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div 
                                  className="font-medium text-gray-900 cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => onAppClick?.(row.appName)}
                                >
                                  {formatCellValue(row.finalAppRiskScore, 'number')}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Final score after AI and scope multipliers</p>
                                <p className="text-xs text-gray-500 mt-1">Click to view app details</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Blast Radius */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div
                                  className="font-normal text-gray-900 cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => onAppClick?.(row.appName)}
                                >
                                  {Math.round(row.blastRadius)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">
                                  Organizational impact: {row.users} users × {row.finalAppRiskScore.toFixed(1)} final score
                                </p>
                                <p className="text-xs text-gray-500 mt-1">Click to view app details</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>

                        {/* Recommended Action */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="cursor-pointer hover:opacity-80 transition-opacity"
                                     onClick={() => onAppClick?.(row.appName)}>
                                  <ActionBadge bucket={row.actionBucket || "Monitor (Low Priority)"} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-sm w-80">
                                <div className="space-y-3 text-left">
                                  <div>
                                    <p className="font-medium text-sm">{row.actionBucket}</p>
                                    <p className="text-xs text-gray-600 mt-1">
                                      {row.adoptionPercent?.toFixed(1)}% of org adoption
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1 italic">
                                      ➡️ {getBucketExplanation(row.actionBucket || "Monitor (Low Priority)")}
                                    </p>
                                  </div>

                                  <div className="text-xs space-y-2">
                                    <p className="font-medium text-gray-900">Suggested Actions:</p>
                                    <ul className="space-y-1">
                                      {getActionSuggestions(row.actionBucket || "Monitor (Low Priority)").map((action, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <span className="text-gray-400 mt-0.5">•</span>
                                          <span className="text-gray-700">{action}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No AI Risk Data Available</h3>
                  <p className="text-gray-500">AI risk analysis data will appear here once applications are processed</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 