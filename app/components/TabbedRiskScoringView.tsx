import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskScoringTab } from './RiskScoringTab';
import { AITechnologyTab } from './AITechnologyTab';
import { SecurityComplianceTab } from './SecurityComplianceTab';
import { BusinessImpactTab } from './BusinessImpactTab';
import { PerformanceAdoptionTab } from './PerformanceAdoptionTab';
import { DetailedApplicationData, AITechnologyData, SecurityComplianceData, BusinessImpactData, PerformanceAdoptionData } from '@/types/ai_risk_application';

// Transform raw AI risk data to detailed app data format
const transformToDetailedAppData = (rawData: any): DetailedApplicationData => {
  // Helper function to safely get field value with trimming
  const getField = (fieldName: string): string => {
    const value = rawData[fieldName];
    return (value && typeof value === 'string') ? value.trim() : "";
  };

  // Create base application data - preserve original field names for matching
  const baseApp = {
    id: rawData.app_id?.toString() || "",
    name: getField("Tool Name"),
    category: getField("Vendor") || "Uncategorized",
    lastUsed: "",
    userCount: 0,
    riskScore: 0,
    riskLevel: "Medium" as const,
    // Preserve the original "Tool Name" field for matching logic
    "Tool Name": getField("Tool Name")
  };

  // Structure detailed data into categories
  const aiTechnology: AITechnologyData = {
    "Key AI Features": getField("Key AI Features"),
    "Proprietary Model or 3rd Party?": getField("Proprietary Model or 3rd Party?"),
    "AI Model Hosting Location / Data Residency": getField("AI Model Hosting Location / Data Residency"),
    "Data Sent to AI Model?": getField("Data Sent to AI Model?"),
    "Type of Data Sent": getField("Type of Data Sent"),
    "Customer/Org Data Used for Model Training?": getField("Customer/Org Data Used for Model Training?"),
    "User Opt-Out of AI?": getField("User Opt-Out of AI?"),
  };

  const securityCompliance: SecurityComplianceData = {
    "Data Retention Policy": getField("Data Retention Policy"),
    "Data Backup/Retrieval/Deletion Details": getField("Data Backup/Retrieval/Deletion Details"),
    "Human Review Involvement": getField("Human Review Involvement"),
    "Security Certifications": getField("Security Certifications"),
    "AI Specific Security Standards": getField("AI Specific Security Standards"),
    "Vulnerability Disclosure": getField("Vulnerability Disclosure"),
    "Recently Known Breaches/ Incidents / Public Issues": getField("Recently Known Breaches/ Incidents / Public Issues"),
    "Supports SSO/SAML/SCIM": getField("Supports SSO/SAML/SCIM"),
    "Authentication Methods": getField("Authentication Methods"),
    "APIs Available?": getField("APIs Available?"),
    "Supports RBAC (or some form of user permissions and roles)?": getField("Supports RBAC (or some form of user permissions and roles)?"),
    "Bug Bounty System Available?": getField("Bug Bounty System Available?"),
    "Trust Contact Info (email ID if available)": getField("Trust Contact Info (email ID if available)"),
    "Other AI-Specific Terms / Disclosures": getField("Other AI-Specific Terms / Disclosures"),
  };

  const businessImpact: BusinessImpactData = {
    "Org Level Criticality (company wide/ specific usage)": getField("Org Level Criticality (company wide/ specific usage)"),
    "Departments/Teams Suitable for App Usage": getField("Departments/Teams Suitable for App Usage"),
    "Impact to Business (when app data/functionality is compromised)": getField("Impact to Business (when app data/functionality is compromised)"),
    "App Performance/Popularity Sentiment": getField("App Performance/Popularity Sentiment"),
    "Ease of App Setup": getField("Ease of App Setup"),
    "Need Employee Training Before Usage?": getField("Need Employee Training Before Usage?"),
    "Overall Security Risk Factor & Tier": getField("Overall Security Risk Factor & Tier"),
    "Renewals & Upgrade Terms": getField("Renewals & Upgrade Terms"),
    "Notes / Observations": getField("Notes / Observations"),
  };

  const performanceAdoption: PerformanceAdoptionData = {
    "Global Adoption Rank": getField("Global Adoption Rank"),
    "No. of Active Customers (Reported)": getField("No. of Active Customers (Reported)"),
    "Popularity percentage": getField("Popularity percentage"),
    "Benchmark Usage by Peers": getField("Benchmark Usage by Peers"),
    "Stack Inclusion Rate": getField("Stack Inclusion Rate"),
    "Best paired with": getField("Best paired with"),
    "Other popular apps in this space": getField("Other popular apps in this space"),
  };

  return {
    ...baseApp,
    aiTechnology,
    securityCompliance,
    businessImpact,
    performanceAdoption,
  };
};

interface App {
  [key: string]: string;
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

interface TabbedRiskScoringViewProps {
  app: App | null;
  allApps: App[];
  orgSettings: OrgSettings;
  selectedAppData?: any;
}

export const TabbedRiskScoringView: React.FC<TabbedRiskScoringViewProps> = ({ 
  app, 
  allApps, 
  orgSettings, 
  selectedAppData 
}) => {
  const [detailedData, setDetailedData] = useState<DetailedApplicationData[]>([]);
  const [rawAIData, setRawAIData] = useState<any>(null); // Raw AI data for risk scoring
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("risk-scoring");

  // Fetch detailed data for the specific app when component mounts or app changes
  useEffect(() => {
    const loadDetailedDataForApp = async (appName: string) => {
      try {
        setLoading(true);
        console.log(`[DEEP_DIVE] Fetching detailed AI data for app: "${appName}"`);
        
        const response = await fetch(`/api/ai-risk-details?appName=${encodeURIComponent(appName)}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch app details');
        }
        
        if (result.data) {
          // Store both the raw data (for RiskScoringTab) and transformed data (for other tabs)
          setRawAIData(result.data); // Store raw data for risk scoring
          const transformedData = [transformToDetailedAppData(result.data)];
          setDetailedData(transformedData);
          console.log(`[DEEP_DIVE] ✅ Loaded detailed data for "${appName}" in ${result.responseTime}ms (cached: ${result.fromCache})`);
          console.log(`[DEEP_DIVE] Raw data individual scores:`, {
            'Data Sensitivity & Processing': result.data?.["Data Sensitivity & Processing"],
            'Security Certification': result.data?.["Security Certification"],
            'Authentication & Access Controls': result.data?.["Authentication & Access Controls"]
          });
        } else {
          console.log(`[DEEP_DIVE] ℹ️ No AI risk data found for "${appName}"`);
          setRawAIData(null);
          setDetailedData([]);
        }
      } catch (error) {
        console.error(`[DEEP_DIVE] ❌ Error loading detailed data for "${appName}":`, error);
        setDetailedData([]);
      } finally {
        setLoading(false);
      }
    };

    if (app && app["Tool Name"]) {
      loadDetailedDataForApp(app["Tool Name"]);
    } else {
      setDetailedData([]);
      setRawAIData(null);
      setLoading(false);
    }
  }, [app]); // Re-fetch when app changes

  // Find the current app's detailed data with improved matching
  const currentAppDetailedData = useMemo(() => {
    if (!app || !detailedData.length) return null;
    
    const appName = app["Tool Name"];
    console.log("Looking for app:", appName);
    console.log("Available apps in detailed data:", detailedData.map(d => d["Tool Name"]));
    
    // Try exact match first
    let foundData = detailedData.find(data => data["Tool Name"] === appName);
    
    // If no exact match, try case-insensitive match
    if (!foundData) {
      const normalizedAppName = appName?.toLowerCase().trim();
      foundData = detailedData.find(data => 
        data["Tool Name"]?.toLowerCase().trim() === normalizedAppName
      );
      if (foundData) {
        console.log("Found match using case-insensitive search");
      }
    }
    
    // If still no match, try partial matching (contains)
    if (!foundData) {
      const normalizedAppName = appName?.toLowerCase().trim();
      foundData = detailedData.find(data => {
        const dataName = data["Tool Name"]?.toLowerCase().trim();
        return dataName && normalizedAppName && (
          dataName.includes(normalizedAppName) || normalizedAppName.includes(dataName)
        );
      });
      if (foundData) {
        console.log("Found match using partial matching:", foundData["Tool Name"]);
      }
    }
    
    console.log("Found detailed data:", foundData ? "Yes" : "No");
    if (foundData) {
      console.log("Matched app name:", foundData["Tool Name"]);
    }
    
    return foundData || null;
  }, [app, detailedData]);

  if (!app) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-center">
          <div className="text-gray-400 mb-3">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">AI Risk Analysis Not Available</h3>
          <p className="text-gray-500 text-sm">AI risk analysis not available for this app</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading detailed app data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 mb-6">
          <TabsTrigger value="risk-scoring" className="text-xs hover-override">Risk Scoring</TabsTrigger>
          <TabsTrigger value="ai-technology" className="text-xs hover-override">AI & Technology</TabsTrigger>
          <TabsTrigger value="security-compliance" className="text-xs hover-override">Security & Compliance</TabsTrigger>
          <TabsTrigger value="business-impact" className="text-xs hover-override">Business Impact & Risk</TabsTrigger>
          <TabsTrigger value="performance-adoption" className="text-xs hover-override">Performance & Adoption</TabsTrigger>
        </TabsList>
        
        <TabsContent value="risk-scoring" className="space-y-4">
          <RiskScoringTab 
            app={rawAIData || app}
            allApps={allApps}
            orgSettings={orgSettings}
            selectedAppData={selectedAppData}
          />
        </TabsContent>
        
        <TabsContent value="ai-technology" className="space-y-4">
          
          
          {currentAppDetailedData ? (
            <AITechnologyTab data={currentAppDetailedData.aiTechnology} />
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No detailed AI & Technology data available for this application.</p>
              <p className="text-xs text-gray-400 mt-2">
                App: {app?.["Tool Name"] || "Unknown"} | Available data: {detailedData.length} records
              </p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="security-compliance" className="space-y-4">
          {currentAppDetailedData ? (
            <SecurityComplianceTab data={currentAppDetailedData.securityCompliance} />
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No detailed Security & Compliance data available for this application.</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="business-impact" className="space-y-4">
          {currentAppDetailedData ? (
            <BusinessImpactTab data={currentAppDetailedData.businessImpact} />
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No detailed Business Impact data available for this application.</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="performance-adoption" className="space-y-4">
          {currentAppDetailedData ? (
            <PerformanceAdoptionTab data={currentAppDetailedData.performanceAdoption} />
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">No detailed Performance & Adoption data available for this application.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}; 