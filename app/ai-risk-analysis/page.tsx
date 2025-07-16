"use client"

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIRiskAnalysisTable } from '@/components/ui/ai-risk-analysis-table';
import Sidebar from '@/app/components/Sidebar';
import { transformRiskLevel } from '@/lib/risk-assessment';

interface AIRiskData {
  appName: string
  category: string
  scopeRisk: string
  users: number
  rawAppRiskScore: number
  finalAppRiskScore: number
  blastRadius: number
}

interface UserInfo {
  name: string;
  email: string;
  avatar_url: string | null;
}

// Helper function to determine category based on AI-Native field
function determineCategory(aiNative: string): string {
  if (!aiNative) return 'No GenAI';
  
  const normalized = aiNative.toLowerCase().trim();
  if (normalized.includes('native') || normalized.includes('yes')) return 'GenAI native';
  if (normalized.includes('partial')) return 'GenAI partial';
  return 'No GenAI';
}

// Helper function to determine scope risk based on score
function determineScopeRisk(score: number): string {
  if (score >= 4.0) return 'High';
  if (score >= 2.5) return 'Medium';
  return 'Low';
}

// Helper function to calculate final risk score using the same logic as main page
function calculateFinalRiskScore(app: any, orgSettings: any): number {
  if (!app) return 0;
  
  // Fuzzy matching to find AI scoring data (app is already the AI data)
  const aiData = app;
  
  // Define scoring criteria using organization settings
  const scoringCriteria = {
    dataPrivacy: { weight: orgSettings.bucketWeights.dataPrivacy, averageField: "Average 1" },
    securityAccess: { weight: orgSettings.bucketWeights.securityAccess, averageField: "Average 2" },
    businessImpact: { weight: orgSettings.bucketWeights.businessImpact, averageField: "Average 3" },
    aiGovernance: { weight: orgSettings.bucketWeights.aiGovernance, averageField: "Average 4" },
    vendorProfile: { weight: orgSettings.bucketWeights.vendorProfile, averageField: "Average 5" }
  };

  // Get AI status
  const aiStatus = aiData?.["AI-Native"]?.toLowerCase() || "";
  
  // Get scope risk from the actual app data (like main page does)
  const getCurrentScopeRisk = () => {
    if (app && app.riskLevel) {
      const riskLevel = transformRiskLevel(app.riskLevel);
      return riskLevel.toUpperCase();
    }
    return 'MEDIUM';
  };
  
  const currentScopeRisk = getCurrentScopeRisk();
  
  // Get scope multipliers from organization settings
  const getScopeMultipliers = (scopeRisk: string) => {
    if (scopeRisk === 'HIGH') return orgSettings.scopeMultipliers.high;
    if (scopeRisk === 'MEDIUM') return orgSettings.scopeMultipliers.medium;
    return orgSettings.scopeMultipliers.low;
  };

  const scopeMultipliers = getScopeMultipliers(currentScopeRisk);
  
  // Get AI multipliers from organization settings
  const getAIMultipliers = (status: string) => {
    const lowerStatus = status.toLowerCase().trim();
    if (lowerStatus.includes("partial")) return orgSettings.aiMultipliers.partial;
    if (lowerStatus.includes("no") || lowerStatus === "" || lowerStatus.includes("not applicable")) return orgSettings.aiMultipliers.none;
    if (lowerStatus.includes("genai") || lowerStatus.includes("native") || lowerStatus.includes("yes")) return orgSettings.aiMultipliers.native;
    return orgSettings.aiMultipliers.none;
  };

  const multipliers = getAIMultipliers(aiStatus);
  
  // Calculate base score
  const calculateBaseScore = () => {
    return Object.values(scoringCriteria).reduce((total, category) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      return total + (numScore * (category.weight / 100) * 2);
    }, 0);
  };

  // Calculate AI score
  const calculateAIScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      return total + (weightedScore * aiMultiplier);
    }, 0);
  };
  
  // Calculate scope score
  const calculateScopeScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      const scopeMultiplier = scopeMultipliers[key as keyof typeof scopeMultipliers] as number;
      return total + (weightedScore * aiMultiplier * scopeMultiplier);
    }, 0);
  };
  
  const baseScore = calculateBaseScore();
  const aiScore = calculateAIScore();
  const scopeScore = calculateScopeScore();
  const genAIAmplification = baseScore > 0 ? aiScore / baseScore : 1.0;
  const scopeAmplification = aiScore > 0 ? scopeScore / aiScore : 1.0;
  const totalAppRiskScore = baseScore * genAIAmplification * scopeAmplification;
  
  return Math.round(totalAppRiskScore * 100) / 100; // Round to 2 decimal places
}

// Helper function to calculate user count (placeholder)
function calculateUserCount(app: any): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Default organization settings - matching main page structure
function getDefaultOrgSettings() {
  return {
    bucketWeights: {
      dataPrivacy: 20,
      securityAccess: 25,
      businessImpact: 20,
      aiGovernance: 15,
      vendorProfile: 20
    },
    aiMultipliers: {
      native: { dataPrivacy: 1.5, securityAccess: 1.8, businessImpact: 1.3, aiGovernance: 2.0, vendorProfile: 1.2 },
      partial: { dataPrivacy: 1.2, securityAccess: 1.4, businessImpact: 1.1, aiGovernance: 1.5, vendorProfile: 1.1 },
      none: { dataPrivacy: 1.0, securityAccess: 1.0, businessImpact: 1.0, aiGovernance: 1.0, vendorProfile: 1.0 }
    },
    scopeMultipliers: {
      high: { dataPrivacy: 1.8, securityAccess: 2.0, businessImpact: 1.4, aiGovernance: 1.6, vendorProfile: 1.3 },
      medium: { dataPrivacy: 1.3, securityAccess: 1.5, businessImpact: 1.2, aiGovernance: 1.2, vendorProfile: 1.1 },
      low: { dataPrivacy: 1.0, securityAccess: 1.0, businessImpact: 1.0, aiGovernance: 1.0, vendorProfile: 1.0 }
    }
  };
}

export default function RiskAnalysisPage() {
  const router = useRouter();
  const [aiRiskData, setAiRiskData] = useState<AIRiskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentView, setCurrentView] = useState('ai-risk-analysis');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [orgSettings, setOrgSettings] = useState(getDefaultOrgSettings());

    // Fetch AI risk data from API
  const fetchAIRiskData = async () => {
    try {
      setLoading(true);
      
      // Get organization ID from URL or cookies
      let fetchOrgIdValue = null;
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlOrgId = urlParams.get('orgId');
        
        if (urlOrgId) {
          fetchOrgIdValue = urlOrgId;
        } else if (document.cookie.split(';').find(cookie => cookie.trim().startsWith('orgId='))) {
          const orgIdCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('orgId='));
          fetchOrgIdValue = orgIdCookie?.split('=')[1].trim();
        }
      }
      
      // Fetch AI risk data, organization settings, and application data concurrently
      const [aiRiskResponse, orgSettingsResponse, applicationsResponse] = await Promise.all([
        fetch('/api/ai-risk-data'),
        fetch(`/api/organization-settings?org_id=${fetchOrgIdValue}`),
        fetch(`/api/applications?orgId=${fetchOrgIdValue}`)
      ]);
      
      if (!aiRiskResponse.ok) {
        throw new Error('Failed to fetch AI risk data');
      }
      
      const aiRiskResult = await aiRiskResponse.json();
      
      if (!aiRiskResult.success || !aiRiskResult.data) {
        setAiRiskData([]);
        return;
      }
      
      // Fetch organization settings (similar to main page)
      let fetchedOrgSettings = getDefaultOrgSettings(); 
      if (orgSettingsResponse.ok) {
        const orgResult = await orgSettingsResponse.json();
        if (orgResult.settings) {
          // Transform snake_case from DB to camelCase for the frontend
          fetchedOrgSettings = {
            bucketWeights: orgResult.settings.bucket_weights,
            aiMultipliers: orgResult.settings.ai_multipliers,
            scopeMultipliers: orgResult.settings.scope_multipliers
          };
        }
      } else {
        console.warn('Could not fetch org settings, using defaults.');
      }
      
      // Update the organization settings state
      setOrgSettings(fetchedOrgSettings);
      
      // Get applications data for scope risk matching
      let applicationsData: any[] = [];
      if (applicationsResponse.ok) {
        applicationsData = await applicationsResponse.json();
      }
      
      // Create a mapping function to find matching application data
      const findMatchingApp = (aiAppName: string) => {
        const cleanAiAppName = aiAppName.trim().toLowerCase();
        
        // First try exact match
        let match = applicationsData.find(app => 
          app.name?.toLowerCase().trim() === cleanAiAppName
        );
        if (match) return match;
        
        // Try fuzzy matching
        for (const app of applicationsData) {
          const appName = app.name?.toLowerCase().trim() || "";
          if (appName.length <= 3 || cleanAiAppName.length <= 3) continue;
          
          // Check if one name contains the other
          if (cleanAiAppName.includes(appName) || appName.includes(cleanAiAppName)) {
            return app;
          }
          
          // Check similarity score
          const words1 = new Set(cleanAiAppName.split(/\s+/));
          const words2 = new Set(appName.split(/\s+/));
          const intersection = new Set([...words1].filter(x => words2.has(x)));
          const union = new Set([...words1, ...words2]);
          const similarity = union.size > 0 ? intersection.size / union.size : 0;
          
          if (similarity > 0.8) {
            return app;
          }
        }
        
        return null;
      };
      
      // Transform the data to match the AIRiskAnalysisTable interface
      const transformedData: AIRiskData[] = aiRiskResult.data.map((app: any) => {
        const rawAppRiskScore = parseFloat(app["Average 1"] || "0");
        
        // Find matching application data to get the correct scope risk
        const matchingApp = findMatchingApp(app["Tool Name"] || "");
        
        // Create app object with proper riskLevel for calculation
        const appWithRiskLevel = {
          ...app,
          riskLevel: matchingApp?.riskLevel || 'Medium', // Use actual app risk level or default to Medium
          name: app["Tool Name"] || 'Unknown'
        };
        
        const finalAppRiskScore = calculateFinalRiskScore(appWithRiskLevel, fetchedOrgSettings);
        const users = matchingApp?.userCount || calculateUserCount(app);
        const blastRadius = users * finalAppRiskScore;

        return {
          appName: app["Tool Name"] || 'Unknown',
          category: determineCategory(app["AI-Native"]),
          scopeRisk: matchingApp?.riskLevel || determineScopeRisk(rawAppRiskScore),
          users: users,
          rawAppRiskScore: rawAppRiskScore,
          finalAppRiskScore: finalAppRiskScore,
          blastRadius: Math.round(blastRadius * 100) / 100,
        };
      });

      // Sort by blast radius (descending)
      const sortedData = transformedData.sort((a, b) => b.blastRadius - a.blastRadius);
      setAiRiskData(sortedData);

    } catch (error) {
      console.error('Error fetching AI risk data:', error);
      setError('Failed to load AI risk data');
      setAiRiskData([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch user info
  const fetchUserInfo = async () => {
    try {
      const response = await fetch('/api/session-info');
      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }
  };

  useEffect(() => {
    fetchAIRiskData();
    fetchUserInfo();
  }, []);

  const handleSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const handleViewChange = (view: string) => {
    setCurrentView(view);
    if (view === 'applications') {
      router.push('/');
    } else if (view === 'organize-app-inbox') {
      router.push('/app-list');
    } else if (view === 'email-notifications') {
      router.push('/settings?view=email-notifications');
    } else if (view === 'organization-settings') {
      router.push('/settings?view=organization-settings');
    } else if (view === 'app-inbox-settings') {
      router.push('/settings?view=authentication');
    }
    setIsSidebarOpen(false);
  };

  const handleSignOut = () => {
    router.push('/api/auth/session/logout');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        onToggle={handleSidebarToggle}
        onCollapse={handleSidebarCollapse}
        currentView={currentView}
        onViewChange={handleViewChange}
        userInfo={userInfo}
        onSignOut={handleSignOut}
      />

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'
      }`}>
        {loading ? (
          // Loading state for main content only
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading AI Risk Analysis...</p>
            </div>
          </div>
        ) : (
          // Main content when loaded
          <div className="container mx-auto px-4 py-8 max-w-7xl">
            {/* Header with back button */}
            <div className="mb-8">
              
              <div className="border-b border-gray-200 pb-4">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Risk Analysis</h1>
                <p className="text-gray-600">
                  Comprehensive analysis of AI-enabled applications and their associated risks across your organization
                </p>
              </div>
            </div>
            
            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-600">{error}</p>
                <Button 
                  onClick={fetchAIRiskData} 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            )}
            
            {/* AI Risk Analysis Table */}
            {!error && (
              <AIRiskAnalysisTable 
                data={aiRiskData}
                highlightTopRows={5}
                orgSettings={orgSettings}
                className="w-full"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
} 