import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { 
  Grid3X3, 
  X,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  LogOut,
  User,
  Bell,
  Sliders,
  Mail,
  Inbox,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface UserInfo {
  name: string;
  email: string;
  avatar_url: string | null;
}

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onCollapse: () => void;
  currentView: string;
  onViewChange: (view: string) => void;
  userInfo: UserInfo | null;
  onSignOut: () => void;
  newAppCount?: number; // Keep this for backward compatibility, but we'll compute it internally
}

export default function Sidebar({ 
  isOpen, 
  isCollapsed, 
  onToggle, 
  onCollapse, 
  currentView, 
  onViewChange,
  userInfo,
  onSignOut,
  newAppCount = 0
}: SidebarProps) {
  const [internalNewAppCount, setInternalNewAppCount] = useState(0);
  
  // Get organization ID from cookies/localStorage
  const getOrgId = () => {
    if (typeof window === 'undefined') return null;
    
    const urlParams = new URLSearchParams(window.location.search);
    const urlOrgId = urlParams.get('orgId');
    
    if (urlOrgId) return urlOrgId;
    
    const cookies = document.cookie.split(';');
    const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
    return orgIdCookie ? orgIdCookie.split('=')[1].trim() : null;
  };

  // Load and monitor newAppCount from localStorage and detect new apps from database
  useEffect(() => {
    const updateNewAppCount = async () => {
      const orgId = getOrgId();
      if (!orgId) {
        setInternalNewAppCount(0);
        return;
      }

      try {
        // Fetch all apps from the database
        const response = await fetch(`/api/organize/apps?shadowOrgId=${orgId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch apps');
        }
        const appsData = await response.json();
        
        // Get stored new app IDs from localStorage
        const storedNewAppIds = localStorage.getItem(`newAppIds_${orgId}`);
        let currentNewAppIds = new Set<string>();
        
        if (storedNewAppIds) {
          try {
            const parsedIds = JSON.parse(storedNewAppIds);
            currentNewAppIds = new Set(parsedIds);
          } catch (error) {
            console.error('Error parsing new app IDs in sidebar:', error);
          }
        }
        
        // Get stored app IDs to detect truly new apps
        const storedAppIds = localStorage.getItem(`allAppIds_${orgId}`);
        let previousAppIds = new Set<string>();
        
        if (storedAppIds) {
          try {
            const parsedIds = JSON.parse(storedAppIds) as string[];
            previousAppIds = new Set(parsedIds);
          } catch (error) {
            console.error('Error parsing stored app IDs:', error);
          }
        }
        
        // Current app IDs from database
        const currentAppIds = new Set<string>(appsData.map((app: any) => String(app.id)));
        
        // Find newly added apps (apps in database but not in previous localStorage)
        const newlyAddedApps = Array.from(currentAppIds).filter(id => !previousAppIds.has(id));
        
        // Add newly discovered apps to newAppIds
        newlyAddedApps.forEach(id => currentNewAppIds.add(id));
        
        // CLEANUP: Remove any newAppIds that no longer exist in the database
        // This fixes the badge count for existing users with corrupted localStorage
        const validNewAppIds = Array.from(currentNewAppIds).filter(id => currentAppIds.has(id));
        currentNewAppIds = new Set(validNewAppIds);
        
        // Update localStorage with current state
        localStorage.setItem(`allAppIds_${orgId}`, JSON.stringify(Array.from(currentAppIds)));
        localStorage.setItem(`newAppIds_${orgId}`, JSON.stringify(Array.from(currentNewAppIds)));
        
        // Update badge count
        setInternalNewAppCount(currentNewAppIds.size);
        
      } catch (error) {
        console.error('Error checking for new apps:', error);
        // Fallback to localStorage only
        const storedNewAppIds = localStorage.getItem(`newAppIds_${orgId}`);
        if (storedNewAppIds) {
          try {
            const parsedIds = JSON.parse(storedNewAppIds);
            setInternalNewAppCount(parsedIds.length);
          } catch (error) {
            console.error('Error parsing new app IDs in sidebar:', error);
            setInternalNewAppCount(0);
          }
        } else {
          setInternalNewAppCount(0);
        }
      }
    };

    // Initial load
    updateNewAppCount();

    // Set up interval to check for changes every 5 seconds
    const interval = setInterval(updateNewAppCount, 5000);

    // Also listen for storage events (when localStorage changes in other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('newAppIds_')) {
        updateNewAppCount();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Use internal count instead of prop
  const displayNewAppCount = internalNewAppCount;

  const sidebarWidth = isCollapsed ? 'w-16' : 'w-56';
  const contentVisibility = isCollapsed ? 'hidden' : 'block';

  // Debug logging
  console.log('Sidebar - displayNewAppCount:', displayNewAppCount);

  // Helper function to get initials from a name
  const getInitials = (name: string): string => {
    if (!name) return "";
    const parts = name.split(/[\s-]+/).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed left-0 top-0 h-screen bg-[#F7F5F2] border-r border-[#E0D5C8] z-50
        transition-all duration-300 ease-in-out
        ${isOpen ? sidebarWidth : '-translate-x-full lg:translate-x-0'}
        ${sidebarWidth}
        lg:fixed lg:translate-x-0
        flex flex-col
      `}>
        {/* Header with Logo */}
        <div className="border-b border-[#E0D5C8] p-4">
          {/* Logo Row */}
          <div className="flex items-center justify-between">
            <div className={`flex items-center ${contentVisibility}`}>
              <Image 
                src="/images/nav-logo.webp" 
                alt="Stitchflow Logo" 
                width={100} 
                height={24}
                className="h-6 w-auto object-contain"
                priority
              />
            </div>
            
            {/* Collapse/Expand Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onCollapse}
              className="hidden lg:flex p-1 h-7 w-7 hover:bg-[#D4C9B8] transition-colors duration-200"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
              ) : (
                <ChevronLeft className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
              )}
            </Button>
            
            {/* Mobile Close Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="lg:hidden p-1 h-7 w-7 hover:bg-[#D4C9B8] transition-colors duration-200"
            >
              <X className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
            </Button>
          </div>
        </div>

        {/* Navigation Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Discover Section */}
          <div>
            <h3 className={`font-medium text-[#7B7481] mb-3 ${contentVisibility}`} style={{ fontSize: '12px', lineHeight: '16px' }}>
              Discover
            </h3>
            <nav className="space-y-1">
              <button
                onClick={() => onViewChange('applications')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'applications' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <Grid3X3 className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'applications' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-normal transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'applications'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                  Discovered Apps
                </span>
              </button>
              
              <button
                onClick={() => onViewChange('ai-risk-analysis')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'ai-risk-analysis' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <BarChart3 className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'ai-risk-analysis' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-normal transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'ai-risk-analysis'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                  AI Risk Analysis
                </span>
              </button>
            </nav>
          </div>

          {/* Organize Section */}
          <div className="mt-6">
            <h3 className={`font-medium text-[#7B7481] mb-3 ${contentVisibility}`} style={{ fontSize: '12px', lineHeight: '16px' }}>
              Organize
            </h3>
            <nav className="space-y-1">
              <button
                onClick={() => onViewChange('organize-app-inbox')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'organize-app-inbox' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <div className="relative">
                  <Inbox className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                    currentView === 'organize-app-inbox' 
                      ? 'text-white' 
                      : 'text-[#7B7481] group-hover:text-[#363338]'
                  }`} />
                  {displayNewAppCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] h-4 flex items-center justify-center font-medium text-[10px] leading-none">
                      {displayNewAppCount}
                    </span>
                  )}
                </div>
                <div className={`flex items-center justify-between w-full ${contentVisibility}`}>
                  <span className={`font-normal transition-colors duration-200 ${
                    currentView === 'organize-app-inbox'
                      ? 'text-white'
                      : 'group-hover:text-[#1A1A1A]'
                  }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                    Managed Apps
                  </span>
                  
                </div>
              </button>
            </nav>
          </div>

          {/* Settings Section */}
          <div className="mt-6">
            <h3 className={`font-medium text-[#7B7481] mb-3 ${contentVisibility}`} style={{ fontSize: '12px', lineHeight: '16px' }}>
              Settings
            </h3>
            <nav className="space-y-1">
              <button
                onClick={() => onViewChange('email-notifications')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'email-notifications' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <Bell className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'email-notifications' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-normal transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'email-notifications'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                  Email Notifications
                </span>
              </button>
              
              <button
                onClick={() => onViewChange('organization-settings')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'organization-settings' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <Sliders className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'organization-settings' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-normal transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'organization-settings'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                 AI Risk Weights
                </span>
              </button>
              
              <button
                onClick={() => onViewChange('app-inbox-settings')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative hover-override
                  ${currentView === 'app-inbox-settings' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <ShieldCheck className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'app-inbox-settings' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-normal transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'app-inbox-settings'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '14px', lineHeight: '20px' }}>
                   IdP
                </span>
              </button>
            </nav>
          </div>

        </div>

        {/* Stitchflow App Link - Above User Section */}
        <div className="border-t border-[#E0D5C8] p-4">
          <button
            onClick={() => window.open('https://app.stitchflow.io/', '_blank', 'noopener,noreferrer')}
            className={`
              w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
              transition-all duration-200 ease-in-out
              group relative hover-override
              text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]
              ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
            `}
          >
            <ExternalLink className="h-4 w-4 flex-shrink-0 transition-colors duration-200 text-[#7B7481] group-hover:text-[#363338]" />
            <span className={`font-normal transition-colors duration-200 ${contentVisibility} group-hover:text-[#1A1A1A]`} style={{ fontSize: '14px', lineHeight: '20px' }}>
              Stitchflow App
            </span>
          </button>
        </div>

        {/* User Section at Bottom */}
        {userInfo && (
          <div className="border-t border-[#E0D5C8] p-4 mt-auto">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isCollapsed ? (
                    // Collapsed Mode - Avatar only
                    <div className="flex justify-center group relative">
                      <div className="h-8 w-8 rounded-full overflow-hidden cursor-pointer hover:opacity-90 hover:scale-105 transition-all duration-200 bg-gray-100 shadow-sm ring-2 ring-white">
                        {userInfo.avatar_url ? (
                          <img 
                            src={userInfo.avatar_url} 
                            alt={userInfo.name || "User"} 
                            className="h-8 w-8 object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const fallback = target.nextElementSibling as HTMLElement;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className={`h-8 w-8 bg-gradient-to-br from-[#363338] to-[#4A444B] text-white text-sm font-semibold flex items-center justify-center rounded-full hover:from-[#4A444B] hover:to-[#5A5461] transition-all duration-200 ${userInfo.avatar_url ? 'hidden' : 'flex'}`}>
                          {getInitials(userInfo.name)}
                        </div>
                      </div>
                      
                      {/* Sign out button for collapsed mode */}
                      <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-all duration-200 transform scale-75 group-hover:scale-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSignOut();
                          }}
                          className="h-5 w-5 p-0 bg-white hover:bg-red-50 text-red-500 hover:text-red-600 border border-red-200 hover:border-red-300 rounded-full shadow-md hover:shadow-lg transition-all duration-200 hover-override"
                          title="Sign out"
                        >
                          <LogOut className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // Expanded Mode - Full profile
                    <div className="relative group">
                      <div className="flex items-center space-x-3 hover:bg-[#D4C9B8] p-2 rounded-lg transition-all duration-200 cursor-pointer">
                        <div className="h-8 w-8 flex-shrink-0 rounded-full overflow-hidden bg-gray-100 ring-2 ring-white shadow-sm">
                          {userInfo.avatar_url ? (
                            <img 
                              src={userInfo.avatar_url} 
                              alt={userInfo.name || "User"} 
                              className="h-8 w-8 object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const fallback = target.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div className={`h-8 w-8 bg-gradient-to-br from-[#363338] to-[#4A444B] text-white text-sm font-semibold flex items-center justify-center rounded-full group-hover:from-[#4A444B] group-hover:to-[#5A5461] transition-all duration-200 ${userInfo.avatar_url ? 'hidden' : 'flex'}`}>
                            {getInitials(userInfo.name)}
                          </div>
                        </div>
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-medium text-[#363338] group-hover:text-[#1A1A1A] transition-colors duration-200 truncate" style={{ fontSize: '12px', lineHeight: '16px' }}>
                            {userInfo.name || 'Unknown User'}
                          </span>
                          <span className="text-[#7B7481] group-hover:text-[#5C5561] transition-colors duration-200 truncate" style={{ fontSize: '10px', lineHeight: '12px' }}>
                            {userInfo.email || 'No email'}
                          </span>
                        </div>
                        
                        {/* Sign out button for expanded mode */}
                        <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-x-2 group-hover:translate-x-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSignOut();
                            }}
                            className="h-6 w-6 p-0 hover:bg-red-50 hover:text-red-600 text-[#7B7481] transition-all duration-200 rounded-md flex-shrink-0 hover-override"
                            title="Sign out"
                          >
                            <LogOut className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </TooltipTrigger>
                <TooltipContent side="right" className="p-3 bg-gray-900 text-white rounded-lg shadow-xl">
                  <div className="space-y-1">
                    <p className="font-medium text-sm">{userInfo.name || 'Unknown User'}</p>
                    <p className="text-xs text-gray-300">{userInfo.email || 'No email'}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </>
  );
} 