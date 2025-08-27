"use client"

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Settings } from "lucide-react";

// Local organization settings interface
interface OrganizationSettings {
  identityProvider: string;
  emailProvider: string;
}

export default function AuthenticationSettings() {
  const [shadowOrgId, setShadowOrgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null);
  const [tempSettings, setTempSettings] = useState<OrganizationSettings>({
    identityProvider: '',
    emailProvider: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  // Get shadow org ID and user email from cookies/localStorage on component mount
  useEffect(() => {
    const orgId = document.cookie
      .split('; ')
      .find(row => row.startsWith('orgId='))
      ?.split('=')[1] || localStorage.getItem('userOrgId');
    
    const email = document.cookie
      .split('; ')
      .find(row => row.startsWith('userEmail='))
      ?.split('=')[1] || localStorage.getItem('userEmail');
    
    setShadowOrgId(orgId);
    setUserEmail(email);

    // Load organization settings from server first, fallback to localStorage if needed
    const loadSettings = async () => {
      setIsLoading(true);
      if (orgId) {
        try {
          // Always try to fetch fresh data from server first
          await fetchSettings(orgId);
        } catch (error) {
          console.error('Error fetching from server, falling back to localStorage:', error);
          // Fallback to localStorage only if server request fails
          const savedSettings = localStorage.getItem(`orgSettings_${orgId}`);
          if (savedSettings) {
            try {
              const settings = JSON.parse(savedSettings);
              const sanitizedSettings = {
                identityProvider: settings.identityProvider === 'EMPTY' ? '' : settings.identityProvider,
                emailProvider: settings.emailProvider === 'EMPTY' ? '' : settings.emailProvider,
              };
              setOrgSettings(sanitizedSettings);
              setTempSettings(sanitizedSettings);
            } catch (parseError) {
              console.error('Error parsing org settings from localStorage:', parseError);
            }
          }
        }
      }
      setIsLoading(false);
    };
    
    loadSettings();
  }, []);

  const fetchSettings = async (orgId: string) => {
    const response = await fetch(`/api/organize/organization?shadowOrgId=${orgId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    
    const data = await response.json();
    const settings = {
      identityProvider: data.identity_provider === 'EMPTY' ? '' : data.identity_provider,
      emailProvider: data.email_provider === 'EMPTY' ? '' : data.email_provider,
    };
    setOrgSettings(settings);
    setTempSettings(settings);
    localStorage.setItem(`orgSettings_${orgId}`, JSON.stringify(settings));
  };

  const handleSave = async () => {
    if (!tempSettings.identityProvider || !tempSettings.emailProvider) {
      setSaveMessage({type: "error", text: "Please select both Identity Provider and Email Provider"});
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      if (shadowOrgId) {
        // Save to the database via API
        const response = await fetch('/api/organize/organization', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shadowOrgId,
            identity_provider: tempSettings.identityProvider,
            email_provider: tempSettings.emailProvider
          })
        });

        if (!response.ok) {
          throw new Error('Failed to save settings to the database');
        }

        // Update localStorage with the new settings
        localStorage.setItem(`orgSettings_${shadowOrgId}`, JSON.stringify(tempSettings));
        setOrgSettings(tempSettings);
        setIsEditMode(false);
        setSaveMessage({type: "success", text: "Settings saved successfully!"});
      } else {
        throw new Error('Organization ID not found');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage({type: "error", text: "Failed to save settings. Please try again."});
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = () => {
    setIsEditMode(true);
    setTempSettings(orgSettings || {identityProvider: '', emailProvider: ''});
    setSaveMessage(null);
  };

  const handleReset = () => {
    setTempSettings(orgSettings || {identityProvider: '', emailProvider: ''});
    setIsEditMode(false);
    setSaveMessage(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F6F3] to-[#E8E3DC]">
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#363338] rounded-lg">
              <Settings className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#363338]">Authentication Settings</h1>
              <p className="text-[#7B7481]">Configure your organization's authentication providers</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <span className="ml-3">Loading settings...</span>
            </div>
          ) : (
            <>
              {/* Save Message */}
              {saveMessage && (
                <div className={`mb-6 p-3 rounded-md text-sm ${
                  saveMessage.type === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {saveMessage.text}
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <Label htmlFor="identity-provider" className="text-base font-medium">Identity Provider</Label>
                  <p className="text-sm text-gray-600 mb-3">Select your organization's identity provider for SSO configuration</p>
                  <Select 
                    value={tempSettings.identityProvider} 
                    onValueChange={(value) => setTempSettings(prev => ({ ...prev, identityProvider: value }))}
                    disabled={!isEditMode}
                  >
                    <SelectTrigger id="identity-provider" className="w-full">
                      <SelectValue placeholder="Select identity provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Okta">Okta</SelectItem>
                      <SelectItem value="Entra ID/Azure AD">Entra ID/Azure AD</SelectItem>
                      <SelectItem value="Google Workspace">Google Workspace</SelectItem>
                      <SelectItem value="JumpCloud">JumpCloud</SelectItem>
                      <SelectItem value="Onelogin">Onelogin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="email-provider" className="text-base font-medium">Email Provider</Label>
                  <p className="text-sm text-gray-600 mb-3">Select your organization's primary email provider</p>
                  <Select 
                    value={tempSettings.emailProvider} 
                    onValueChange={(value) => setTempSettings(prev => ({ ...prev, emailProvider: value }))}
                    disabled={!isEditMode}
                  >
                    <SelectTrigger id="email-provider" className="w-full">
                      <SelectValue placeholder="Select email provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Google">Google</SelectItem>
                      <SelectItem value="Microsoft">Microsoft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Current Settings Display */}
                {orgSettings && (orgSettings.identityProvider || orgSettings.emailProvider) && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="font-medium text-gray-900 mb-2">Current Settings</h3>
                    <div className="text-sm text-gray-700 space-y-1">
                      <p><span className="font-medium">Identity Provider:</span> {orgSettings.identityProvider || 'Not set'}</p>
                      <p><span className="font-medium">Email Provider:</span> {orgSettings.emailProvider || 'Not set'}</p>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  {!isEditMode ? (
                    <Button 
                      variant="outline" 
                      onClick={handleEdit}
                      disabled={isSaving}
                    >
                      Edit
                    </Button>
                  ) : (
                    <Button 
                      variant="outline" 
                      onClick={handleReset}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button 
                    onClick={handleSave}
                    disabled={isSaving || !isEditMode || (!tempSettings.identityProvider || !tempSettings.emailProvider)}
                    className="bg-[#363338] hover:bg-[#2A262B] text-white"
                  >
                    {isSaving ? 'Saving...' : 'Save Settings'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
} 