"use client"

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Bell } from "lucide-react";

interface NotificationPreferences {
  new_app_detected: boolean;
  new_user_in_app: boolean;
  new_user_in_review_app: boolean;
}

export default function EmailNotificationsSettings() {
  const router = useRouter();
  const [notificationSettings, setNotificationSettings] = useState<NotificationPreferences>({
    new_app_detected: true,
    new_user_in_app: true,
    new_user_in_review_app: true
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load user notification preferences on mount
  useEffect(() => {
    loadNotificationPreferences();
  }, []);

  const loadNotificationPreferences = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Read the orgId from cookie or URL parameters
      const orgId = getOrgIdFromCookieOrUrl();
      
      if (!orgId) {
        throw new Error('Organization ID not found. Please try logging in again.');
      }
      
      // Fetch user email from cookies
      const userEmail = getUserEmailFromCookie();
      
      if (!userEmail) {
        throw new Error('Session expired. Please try logging in again.');
      }
      
      // Fetch notification preferences
      const response = await fetch(`/api/user/notification-preferences?orgId=${orgId}`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load notification preferences. Please try again.');
      }
      
      const data = await response.json();
      
      // Update state with loaded preferences
      if (data && data.preferences) {
        setNotificationSettings({
          new_app_detected: data.preferences.new_app_detected,
          new_user_in_app: data.preferences.new_user_in_app,
          new_user_in_review_app: data.preferences.new_user_in_review_app
        });
      }
    } catch (err) {
      console.error('Error loading notification preferences:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettingChange = (setting: keyof NotificationPreferences, value: boolean) => {
    setNotificationSettings(prev => ({
      ...prev,
      [setting]: value
    }));
    
    // Reset success message when user makes a change
    setSaveSuccess(false);
  };

  const handleSaveSettings = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);
      
      // Read the orgId from cookie or URL parameters
      const orgId = getOrgIdFromCookieOrUrl();
      
      if (!orgId) {
        throw new Error('Organization ID not found');
      }
      
      // Save notification preferences
      const response = await fetch('/api/user/notification-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          orgId,
          preferences: notificationSettings
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save notification preferences');
      }
      
      setSaveSuccess(true);
    } catch (err) {
      console.error('Error saving notification preferences:', err);
      setError('Failed to save preferences. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper function to get orgId from cookie or URL
  const getOrgIdFromCookieOrUrl = (): string | null => {
    // First try URL parameters
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlOrgId = urlParams.get('orgId');
      
      if (urlOrgId) {
        return urlOrgId;
      }
      
      // Then try cookies
      const cookies = document.cookie.split(';');
      const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
      if (orgIdCookie) {
        return orgIdCookie.split('=')[1].trim();
      }
    }
    
    return null;
  };
  
  // Helper function to get user email from cookie
  const getUserEmailFromCookie = (): string | null => {
    if (typeof window !== 'undefined') {
      const cookies = document.cookie.split(';').map(cookie => cookie.trim());
      const userEmailCookie = cookies.find(cookie => cookie.startsWith('userEmail='));
      
      if (userEmailCookie) {
        try {
          // Decode the cookie value as it might be URL encoded
          return decodeURIComponent(userEmailCookie.split('=')[1]);
        } catch (error) {
          console.error('Error parsing userEmail cookie:', error);
          return null;
        }
      }
    }
    
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F6F3] to-[#E8E3DC]">
      <div className="container mx-auto px-6 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#363338] rounded-lg">
              <Bell className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#363338]">Email Notifications</h1>
              <p className="text-[#7B7481]">Customize your notification preferences</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-6 space-y-6">
            {isLoading ? (
              <div className="flex justify-center items-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <span className="ml-3">Loading settings...</span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
                    {error}
                  </div>
                )}
                
                {saveSuccess && (
                  <div className="p-3 bg-green-50 text-green-700 rounded-md text-sm">
                    Settings saved successfully!
                  </div>
                )}
                
                <div className="space-y-4">
                  {/* New App Detection */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <Label className="font-medium">New App Detection</Label>
                      <p className="text-sm text-gray-500">Get a weekly digest of newly-discovered apps in your org</p>
                    </div>
                    <div 
                      className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                      onClick={() => handleSettingChange('new_app_detected', !notificationSettings.new_app_detected)}
                      style={{ backgroundColor: notificationSettings.new_app_detected ? '#111827' : '#E5E7EB' }}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.new_app_detected ? 'translate-x-6' : 'translate-x-1'}`} />
                    </div>
                  </div>

                  {/* New User Notifications */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <Label className="font-medium">New User Detection</Label>
                      <p className="text-sm text-gray-500">Get regular alerts when new user(s) sign up for apps in your org</p>
                    </div>
                    <div 
                      className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                      onClick={() => handleSettingChange('new_user_in_app', !notificationSettings.new_user_in_app)}
                      style={{ backgroundColor: notificationSettings.new_user_in_app ? '#111827' : '#E5E7EB' }}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.new_user_in_app ? 'translate-x-6' : 'translate-x-1'}`} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
            <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveSettings} 
              disabled={isLoading || isSaving}
              className={`${isSaving ? 'opacity-70 cursor-not-allowed' : ''} bg-[#363338] hover:bg-[#2A262B] text-white`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
} 