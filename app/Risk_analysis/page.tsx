"use client"

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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

// Helper function to calculate final risk score
function calculateFinalRiskScore(app: any): number {
  const averages = [
    parseFloat(app["Average 1"] || "0"),
    parseFloat(app["Average 2"] || "0"),
    parseFloat(app["Average 3"] || "0"),
    parseFloat(app["Average 4"] || "0"),
    parseFloat(app["Average 5"] || "0"),
  ];
  
  const validAverages = averages.filter(avg => !isNaN(avg) && avg > 0);
  if (validAverages.length === 0) return 0;
  
  const weightedAverage = validAverages.reduce((sum, avg) => sum + avg, 0) / validAverages.length;
  
  // Apply AI multiplier based on AI-Native status
  const aiNative = app["AI-Native"]?.toLowerCase() || "";
  let multiplier = 1.0;
  if (aiNative.includes('native') || aiNative.includes('yes')) {
    multiplier = 1.5;
  } else if (aiNative.includes('partial')) {
    multiplier = 1.2;
  }
  
  return Math.round(weightedAverage * multiplier * 100) / 100;
}

// Helper function to calculate user count (placeholder)
function calculateUserCount(app: any): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Default organization settings
function getDefaultOrgSettings() {
  return {
    bucketWeights: {
      dataPrivacy: 30,
      securityAccess: 25,
      businessImpact: 20,
      aiGovernance: 15,
      vendorProfile: 10,
    },
    aiMultipliers: {
      native: { multiplier: 1.5 },
      partial: { multiplier: 1.2 },
      none: { multiplier: 1.0 },
    },
    scopeMultipliers: {
      high: { multiplier: 1.4 },
      medium: { multiplier: 1.2 },
      low: { multiplier: 1.0 },
    },
  };
}

export default function RiskAnalysisPage() {
  const [aiRiskData, setAiRiskData] = useState<AIRiskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentView, setCurrentView] = useState('ai-risk-analysis');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  const orgSettings = getDefaultOrgSettings();

  // Fetch AI risk data from API
  const fetchAIRiskData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/ai-risk-data');
      
      if (!response.ok) {
        throw new Error('Failed to fetch AI risk data');
      }
      
      const result = await response.json();
      
      if (!result.success || !result.data) {
        setAiRiskData([]);
        return;
      }
      
      // Transform the data to match the AIRiskAnalysisTable interface
      const transformedData: AIRiskData[] = result.data.map((app: any) => {
        const rawAppRiskScore = parseFloat(app["Average 1"] || "0");
        const finalAppRiskScore = calculateFinalRiskScore(app);
        const users = calculateUserCount(app);
        const blastRadius = users * finalAppRiskScore;

        return {
          appName: app["Tool Name"] || 'Unknown',
          category: determineCategory(app["AI-Native"]),
          scopeRisk: determineScopeRisk(rawAppRiskScore),
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
      window.location.href = '/';
    }
    setIsSidebarOpen(false);
  };

  const handleSignOut = () => {
    window.location.href = '/api/auth/session/logout';
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
              <div className="flex items-center gap-4 mb-4">
                <Link href="/">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 hover:bg-gray-100"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Dashboard
                  </Button>
                </Link>
              </div>
              
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