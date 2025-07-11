"use client"

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from "@/app/components/Sidebar";
import EmailNotificationsSettings from './components/EmailNotificationsSettings';
import OrganizationSettings from './components/OrganizationSettings';
import AuthenticationSettings from './components/AuthenticationSettings';

interface UserInfo {
  name: string;
  email: string;
  avatar_url: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentView, setCurrentView] = useState('email-notifications');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Get view from URL parameters
  useEffect(() => {
    const view = searchParams.get('view') || 'email-notifications';
    setCurrentView(view);
  }, [searchParams]);

  // Fetch user info
  useEffect(() => {
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
    if (view === "applications") {
      router.push("/");
    } else if (view === "ai-risk-analysis") {
      router.push("/ai-risk-analysis");
    } else if (view === "organize-app-inbox") {
      router.push("/app-list");
    } else if (view === "email-notifications") {
      router.push("/settings?view=email-notifications");
    } else if (view === "organization-settings") {
      router.push("/settings?view=organization-settings");
    } else if (view === "app-inbox-settings") {
      router.push("/settings?view=authentication");
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

      {/* Main Content - Dynamic Settings Component */}
      <div className={`flex-1 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'ml-16' : 'ml-56'}`}>
        {currentView === 'email-notifications' && <EmailNotificationsSettings />}
        {currentView === 'organization-settings' && <OrganizationSettings />}
        {currentView === 'authentication' && <AuthenticationSettings />}
      </div>
    </div>
  );
} 