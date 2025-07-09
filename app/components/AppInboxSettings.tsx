"use client"

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Settings, Save } from "lucide-react";

// Local organization settings interface
interface OrganizationSettings {
  identityProvider: string;
  emailProvider: string;
}

interface AppInboxSettingsProps {
  // No props needed for now
}

export default function AppInboxSettings({}: AppInboxSettingsProps) {
  const [shadowOrgId, setShadowOrgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings | null>(null);
  const [tempSettings, setTempSettings] = useState<OrganizationSettings>({
    identityProvider: '',
    emailProvider: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

    // Load organization settings from localStorage
    const savedSettings = localStorage.getItem(`orgSettings_${orgId}`);
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setOrgSettings(settings);
        setTempSettings(settings);
      } catch (error) {
        console.error('Error parsing org settings:', error);
      }
    }

    // Also try to load from the database
    const loadOrgSettings = async () => {
      if (!orgId) return;
      
      try {
        const response = await fetch(`/api/organize/organization?shadowOrgId=${orgId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const organization = await response.json();
          if (organization && organization.identity_provider && organization.email_provider) {
            const settings = {
              identityProvider: organization.identity_provider,
              emailProvider: organization.email_provider
            };
            
            setOrgSettings(settings);
            setTempSettings(settings);
            // Save to localStorage for future use
            localStorage.setItem(`orgSettings_${orgId}`, JSON.stringify(settings));
          }
        }
      } catch (error) {
        console.error('Error loading organization settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (!savedSettings) {
      loadOrgSettings();
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleSave = async () => {
    if (!tempSettings.identityProvider || !tempSettings.emailProvider) {
      setSaveMessage({ type: "error", text: "Please select both identity provider and email provider." });
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Save to database
      if (shadowOrgId) {
        const response = await fetch('/api/organize/organization', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shadowOrgId,
            identity_provider: tempSettings.identityProvider,
            email_provider: tempSettings.emailProvider
          })
        });

        if (!response.ok) {
          throw new Error('Failed to save settings to database');
        }
      }

      // Update local state
      setOrgSettings(tempSettings);
      
      // Save to localStorage
      if (shadowOrgId) {
        localStorage.setItem(`orgSettings_${shadowOrgId}`, JSON.stringify(tempSettings));
      }

      setSaveMessage({ type: "success", text: "Settings saved successfully!" });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);

    } catch (error) {
      console.error('Error saving organization settings:', error);
      setSaveMessage({ type: "error", text: "Failed to save settings. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-bg-light items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-light">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <Settings className="h-6 w-6 text-gray-600" />
            <h1 className="text-2xl font-semibold text-gray-900">App Inbox Settings</h1>
          </div>

          <div className="space-y-6">
            <div>
              <Label htmlFor="identity-provider" className="text-base font-medium">Identity Provider</Label>
              <p className="text-sm text-gray-600 mb-3">Select your organization's identity provider for SSO configuration</p>
              <Select 
                value={tempSettings.identityProvider} 
                onValueChange={(value) => setTempSettings(prev => ({ ...prev, identityProvider: value }))}
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
              <p className="text-sm text-gray-600 mb-3">Select your organization's email provider for integration</p>
              <Select 
                value={tempSettings.emailProvider} 
                onValueChange={(value) => setTempSettings(prev => ({ ...prev, emailProvider: value }))}
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
            {orgSettings && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-medium text-blue-900 mb-2">Current Settings</h3>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><span className="font-medium">Identity Provider:</span> {orgSettings.identityProvider}</p>
                  <p><span className="font-medium">Email Provider:</span> {orgSettings.emailProvider}</p>
                </div>
              </div>
            )}

            {/* Save Message */}
            {saveMessage && (
              <div className={`p-4 rounded-lg border ${
                saveMessage.type === "success" 
                  ? "bg-green-50 border-green-200 text-green-800" 
                  : "bg-red-50 border-red-200 text-red-800"
              }`}>
                <p className="text-sm font-medium">
                  {saveMessage.type === "success" ? "✅" : "❌"} {saveMessage.text}
                </p>
              </div>
            )}

            {/* Save Button */}
            <div className="flex justify-end">
              <Button 
                onClick={handleSave} 
                disabled={!tempSettings.identityProvider || !tempSettings.emailProvider || isSaving}
                className="px-6"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Settings
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 