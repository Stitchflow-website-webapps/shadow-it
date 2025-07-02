"use client"

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Settings } from "lucide-react";
import Sidebar from "@/app/components/Sidebar";

// --- TYPE DEFINITIONS ---

interface BucketWeights {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
}

interface MultiplierCategory {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
}

interface OrgSettings {
    bucketWeights: BucketWeights;
    aiMultipliers: {
        native: MultiplierCategory;
        partial: MultiplierCategory;
        none: MultiplierCategory;
    };
    scopeMultipliers: {
        high: MultiplierCategory;
        medium: MultiplierCategory;
        low: MultiplierCategory;
    };
}

export default function OrganizationSettingsPage() {
  const router = useRouter();

  // Sidebar state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [currentView, setCurrentView] = useState('organization-settings');
  const [userInfo, setUserInfo] = useState<{ name: string; email: string; avatar_url: string | null } | null>(null);
  const [tempSettings, setTempSettings] = useState<OrgSettings>({
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
      low: { dataPrivacy: 1.1, securityAccess: 1.2, businessImpact: 1.0, aiGovernance: 1.0, vendorProfile: 1.0 }
    }
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load settings on mount
    loadSettings();
    fetchUserInfo();
  }, []);

  const fetchUserInfo = async () => {
    try {
      const response = await fetch('/api/session-info', {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setUserInfo(data.user);
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }
  };

  const handleSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const handleViewChange = (view: string) => {
    setCurrentView(view);
    if (view === "applications") {
      router.push("/");
    } else if (view === "ai-risk-analysis") {
      router.push("/Risk_analysis");
    } else if (view === "email-notifications") {
      router.push("/email-notifications");  
    }
    setIsSidebarOpen(false);
  };

  const handleSignOut = () => {
    // Clear cookies and redirect to login
    const cookiesToClear = ['orgId', 'userEmail', 'accessToken', 'refreshToken'];
    cookiesToClear.forEach(cookieName => {
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    });
    router.push('/login');
  };

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/organization-settings', {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setTempSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('Error loading organization settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to get orgId from cookie
  const getOrgIdFromCookie = (): string | null => {
    if (typeof window !== 'undefined') {
      const cookies = document.cookie.split(';');
      const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
      if (orgIdCookie) {
        return orgIdCookie.split('=')[1].trim();
      }
    }
    return null;
  };

  const handleSave = async () => {
    const totalWeight = Object.values(tempSettings.bucketWeights).reduce((sum, weight) => sum + weight, 0);
    if (totalWeight !== 100) {
      alert("Total weight must be 100%.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const orgId = getOrgIdFromCookie();
      if (!orgId) {
        throw new Error('Organization ID not found. Please try logging in again.');
      }

      const response = await fetch('/api/organization-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: orgId,
          bucket_weights: tempSettings.bucketWeights,
          ai_multipliers: tempSettings.aiMultipliers,
          scope_multipliers: tempSettings.scopeMultipliers,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save organization settings');
      }

      const result = await response.json();
      console.log('Organization settings saved successfully:', result);

      setSaveSuccess(true);
      
      // Refresh the page after a short delay to show success message
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error) {
      console.error('Error saving organization settings:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };
  
  const totalWeight = Object.values(tempSettings.bucketWeights).reduce((sum, weight) => sum + weight, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8F6F3] to-[#E8E3DC] flex items-center justify-center">
        <div className="text-[#7B7481]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F6F3] to-[#E8E3DC] flex">
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
      <div className={`flex-1 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'ml-16' : 'ml-56'}`}>
      <div className="container mx-auto px-6 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => router.back()}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#363338] rounded-lg">
              <Settings className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#363338]">Organization Score Settings</h1>
              <p className="text-[#7B7481]">Customize scoring weights and multipliers for your organization's risk assessment methodology</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl shadow-lg p-4 max-h-[85vh] flex flex-col">
          <div className="mb-4">
            <div className="p-2 bg-blue-50 border-l-4 border-blue-400 rounded">
              <p className="text-sm text-blue-700">
                <span className="font-medium">Note:</span> Any changes to these settings will update risk scores across the application.
              </p>
            </div>
          </div>
        
          <div className="flex-1 overflow-y-auto space-y-5 px-2">
            {/* Bucket Weights Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold ml-1">Category Weights</h3>
              <p className="text-sm text-gray-600 ml-1">Adjust the importance of each risk category. Total must equal 100%.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(tempSettings.bucketWeights).map(([key, value]) => (
                  <div className="space-y-1" key={key}>
                    <Label htmlFor={key} className="text-sm font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                    <div className="flex items-center space-x-2">
                      <Input
                        id={key}
                        type="number"
                        min="0"
                        max="100"
                        value={value}
                        onChange={(e) => setTempSettings(prev => ({
                          ...prev,
                          bucketWeights: { ...prev.bucketWeights, [key]: Number(e.target.value) }
                        }))}
                        className="w-20 h-9 text-sm px-3 text-center"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                ))}
              </div>
              {totalWeight !== 100 ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-sm text-red-700">⚠️ Total weight is {totalWeight}%. Must equal 100% to save.</p>
                </div>
              ) : (
                <div className="p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-sm text-green-700">✅ Total weight: {totalWeight}%</p>
                </div>
              )}
            </div>
          
            {/* AI Multipliers Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold ml-1">GenAI Risk Multipliers</h3>
              <p className="text-sm text-gray-600 ml-1">Adjust risk multipliers based on GenAI's impact on an app.</p>
              {Object.entries(tempSettings.aiMultipliers).map(([level, multipliers]) => (
                <div key={level} className="space-y-3">
                  <h4 className="text-base font-medium text-gray-900 ml-1 capitalize">{level}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                    {Object.entries(multipliers).map(([cat, val]) => (
                      <div className="space-y-1" key={cat}>
                        <Label className="text-sm capitalize">{cat.replace(/([A-Z])/g, ' $1')}</Label>
                        <Input
                          type="number"
                          step="0.05"
                          min="1.0"
                          max="3.0"
                          value={val}
                          onChange={(e) => setTempSettings(prev => ({
                            ...prev,
                            aiMultipliers: { ...prev.aiMultipliers, [level]: { ...prev.aiMultipliers[level as keyof typeof prev.aiMultipliers], [cat]: Number(e.target.value) } }
                          }))}
                          className="h-9 text-sm px-3 text-center"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          
            {/* Scope Risk Multipliers Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold ml-1">Scope Risk Multipliers</h3>
              <p className="text-sm text-gray-600 ml-1">Adjust risk multipliers based on an application's scope permissions.</p>
              {Object.entries(tempSettings.scopeMultipliers).map(([level, multipliers]) => (
                <div key={level} className="space-y-3">
                  <h4 className="text-base font-medium text-gray-900 ml-1 capitalize">{level}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                    {Object.entries(multipliers).map(([cat, val]) => (
                      <div className="space-y-1" key={cat}>
                        <Label className="text-sm capitalize">{cat.replace(/([A-Z])/g, ' $1')}</Label>
                        <Input
                          type="number"
                          step="0.05"
                          min="1.0"
                          max="3.0"
                          value={val}
                          onChange={(e) => setTempSettings(prev => ({
                            ...prev,
                            scopeMultipliers: { ...prev.scopeMultipliers, [level]: { ...prev.scopeMultipliers[level as keyof typeof prev.scopeMultipliers], [cat]: Number(e.target.value) } }
                          }))}
                          className="w-full h-9 text-sm px-3 text-center"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        
          <div className="flex flex-col space-y-3 pt-3 px-2 border-t bg-white flex-shrink-0">
            {/* Error Message */}
            {saveError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-sm text-red-700">❌ {saveError}</p>
              </div>
            )}
          
            {/* Success Message */}
            {saveSuccess && (
              <div className="p-3 bg-green-50 border border-green-200 rounded">
                <p className="text-sm text-green-700">✅ Settings saved successfully! Refreshing page...</p>
              </div>
            )}
          
            {/* Action Buttons */}
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
                Cancel
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={totalWeight !== 100 || isSaving}
                className="bg-[#363338] hover:bg-[#2A262B] text-white"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
} 