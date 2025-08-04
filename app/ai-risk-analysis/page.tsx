"use client"

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIRiskAnalysisTable } from '@/components/ui/ai-risk-analysis-table';
import Sidebar from '@/app/components/Sidebar';

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

// Default organization settings for display purposes
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
  const [responseTime, setResponseTime] = useState<number>(0);
  const [fromCache, setFromCache] = useState(false);

  // Optimized data fetching using the new combined API endpoint
  const fetchAIRiskData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[PERF] 🚀 Starting optimized AI Risk Analysis data fetch...');
      const startTime = Date.now();
      
      // Single API call to the optimized endpoint
      const response = await fetch('/api/ai-risk-analysis');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch AI risk analysis data: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch AI risk analysis data');
      }
      
      // Set the processed data directly from the server response
      setAiRiskData(result.data || []);
      setResponseTime(result.responseTime || (Date.now() - startTime));
      setFromCache(result.fromCache || false);
      
      console.log(`[PERF] ✅ AI Risk Analysis data loaded in ${result.responseTime || (Date.now() - startTime)}ms`);
      console.log(`[PERF] Cache status: ${result.fromCache ? 'HIT' : 'MISS'}`);
      console.log(`[PERF] Processed ${result.data?.length || 0} applications`);
      
      if (result.metadata) {
        console.log(`[PERF] Metadata: ${result.metadata.totalApps} total apps, ${result.metadata.aiRiskMatches} AI risk matches, ${result.metadata.processedApps} processed apps`);
      }

    } catch (error) {
      console.error('Error fetching AI risk data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load AI risk data');
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

  const handleAppClick = (appName: string) => {
    // Navigate to main dashboard with the app selected and AI risk scoring tab active
    router.push(`/?selectedApp=${encodeURIComponent(appName)}&defaultTab=ai-risk-scoring`);
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
            {/* Header */}
            <div className="mb-8">
              <div className="border-b border-gray-200 pb-4">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Risk Analysis</h1>
                <p className="text-gray-600">
                  Comprehensive analysis of AI-enabled applications and their associated risks across your organization
                </p>
                {/* Performance indicators */}
                {(responseTime > 0 || fromCache) && (
                  <div className="mt-2 text-sm text-gray-500">
                    <span>
                      Loaded in {responseTime}ms {fromCache && '(cached)'}
                      {aiRiskData.length > 0 && ` • ${aiRiskData.length} applications analyzed`}
                    </span>
                  </div>
                )}
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
                highlightTopRows={0}
                orgSettings={orgSettings}
                className="w-full"
                onAppClick={handleAppClick}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
} 