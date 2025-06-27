import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskScoringTab } from './RiskScoringTab';
import { AITechnologyTab } from './AITechnologyTab';
import { SecurityComplianceTab } from './SecurityComplianceTab';
import { BusinessImpactTab } from './BusinessImpactTab';
import { PerformanceAdoptionTab } from './PerformanceAdoptionTab';
import { fetchDetailedAppData } from '@/app/lib/data';
import { DetailedApplicationData } from '@/types/application';

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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("risk-scoring");

  // Fetch detailed data on component mount
  useEffect(() => {
    const loadDetailedData = async () => {
      try {
        const data = await fetchDetailedAppData();
        setDetailedData(data);
      } catch (error) {
        console.error("Error loading detailed data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDetailedData();
  }, []);

  // Find the current app's detailed data
  const currentAppDetailedData = useMemo(() => {
    if (!app || !detailedData.length) return null;
    
    const appName = app["Tool Name"];
    return detailedData.find(data => (data as any)["Tool Name"] === appName) || null;
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
          <TabsTrigger value="risk-scoring" className="text-xs">Risk Scoring</TabsTrigger>
          <TabsTrigger value="ai-technology" className="text-xs">AI & Technology</TabsTrigger>
          <TabsTrigger value="security-compliance" className="text-xs">Security & Compliance</TabsTrigger>
          <TabsTrigger value="business-impact" className="text-xs">Business Impact & Risk</TabsTrigger>
          <TabsTrigger value="performance-adoption" className="text-xs">Performance & Adoption</TabsTrigger>
        </TabsList>
        
        <TabsContent value="risk-scoring" className="space-y-4">
          <RiskScoringTab 
            app={app}
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