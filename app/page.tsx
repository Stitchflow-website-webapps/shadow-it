"use client"

import React, { useState, useEffect, useMemo, useRef } from "react"
import {
  User,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  BarChart3,
  ArrowLeft,
  Info,
  CheckCircle,
  AlertTriangle,
  LayoutGrid,
  Settings,
  X,
  Eye,
  LogOut,
  ExternalLink,
  ScanSearch,
  LayoutDashboard,
  BellRing,
  ShieldAlert,
  ChartNoAxesCombined,
  Bell,
  ArrowRight,
  ArrowRightIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { WhyStitchflow } from "@/components/ui/demo";
import { Button } from "@/components/ui/button"
import Button_website from "@/components/ui/Button_website"
import Link from 'next/link';
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { JSX } from "react"
import { useDebounce } from "@/app/hooks/useDebounce"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { FAQ } from "@/components/ui/faq"
import { FeedbackChat } from "@/components/ui/feedback";
import { Share } from "@/components/ui/share";
// Import the Sidebar component
import Sidebar from "@/app/components/Sidebar";
// Import risk assessment utilities
import { HIGH_RISK_SCOPES, MEDIUM_RISK_SCOPES } from "@/lib/risk-assessment";
// Import AI risk utilities
import { supabaseAIAdmin } from "@/lib/supabase-ai-schema";

import { determineRiskLevel, transformRiskLevel, getRiskLevelColor, evaluateSingleScopeRisk, RiskLevel } from '@/lib/risk-assessment'; // Corrected import alias and added type import
import { useSearchParams } from "next/navigation"
import { LabelList } from "recharts"
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TabbedRiskScoringView } from "@/app/components/TabbedRiskScoringView";
import { Select, SelectTrigger, SelectValue, SelectItem, SelectContent } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
// Import AI Risk Cache utilities
import { 
  cacheAIRiskScores, 
  getCachedAIRiskScores, 
  isCacheValid,
  shouldRefreshCache,
  getCacheTimeRemaining,
  type CachedAIRiskScore 
} from '@/lib/ai-risk-cache';

// Type definitions
type Application = {
  id: string
  name: string
  category: string | null // Modified to allow null
  userCount: number
  users: AppUser[]
  riskLevel: RiskLevel
  riskReason: string
  totalPermissions: number
  scopeVariance: { userGroups: number; scopeGroups: number }
  logoUrl?: string      // Primary logo URL
  logoUrlFallback?: string // Fallback logo URL
  created_at?: string   // Added created_at field
  managementStatus: "Managed" | "Unmanaged" | "Newly discovered" | "Unknown" | "Ignore" | "Not specified"
  ownerEmail: string
  notes: string
  scopes: string[]
  isInstalled: boolean
  isAuthAnonymously: boolean
  isCategorizing?: boolean // Added to track categorization status
  aiRiskScore?: number | null // Added AI Risk Score for real-time calculation
}

type AppUser = {
  id: string
  appId: string
  name: string
  email: string
  lastActive?: string
  created_at?: string
  scopes: string[]
  riskLevel: RiskLevel
  riskReason: string
}

// Sort types
type SortColumn =
  | "name"
  | "userCount"
  | "riskLevel"
  | "totalPermissions"
  // | "lastLogin" // Removed
  | "managementStatus"
  | "highRiskUserCount" // Added for the new column
  | "aiRiskScore" // Added AI Risk Score column
type SortDirection = "asc" | "desc"

// User table sort types
type UserSortColumn = "name" | "email" | "created" | "riskLevel"

// Chart data types
type CategoryData = {
  name: string
  value: number
  color: string
}

type BarChartData = {
  name: string
  users: number
  apps: number
}

type RiskData = {
  name: string
  value: number
  color: string
}

const X_AXIS_HEIGHT = 30;
const Y_AXIS_WIDTH = 150;
const CHART_TOTAL_HEIGHT = 384; // Corresponds to h-96
const BAR_VIEWPORT_HEIGHT = CHART_TOTAL_HEIGHT - X_AXIS_HEIGHT;
const BAR_THICKNESS_WITH_PADDING = 30;

// Helper function to truncate text
const truncateText = (text: string, maxLength: number = 20) => {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...";
  }
  return text;
};

// Helper function to get initials from a name
const getInitials = (name: string): string => {
  if (!name) return "";

  // Split by space or hyphen to handle names like "John-Doe"
  const parts = name.split(/[\s-]+/).filter(Boolean);

  if (parts.length === 0) return "";

  // For a single word name, take the first two letters. For "J", it will be "J".
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }

  // For multi-word names, take the first letter of the first and last parts.
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function ShadowITDashboard() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [filterRisk, setFilterRisk] = useState<string | null>(null)
  const [filterManaged, setFilterManaged] = useState<string | null>(null)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [defaultTab, setDefaultTab] = useState<string>("users")
  const [isLoading, setIsLoading] = useState(true)
  const [userSearchTerm, setUserSearchTerm] = useState("")
  const [editedStatuses, setEditedStatuses] = useState<Record<string, string>>({})
  const [mainView, setMainView] = useState<"list" | "Insights">("list")
  const [currentPage, setCurrentPage] = useState(1)
  const [userCurrentPage, setUserCurrentPage] = useState(1)
  const [scopeCurrentPage, setScopeCurrentPage] = useState(1)
  const itemsPerPage = 20

  // Sorting state - will be set based on AI risk score data availability
  const [sortColumn, setSortColumn] = useState<SortColumn>("riskLevel")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const [userSortColumn, setUserSortColumn] = useState<"name" | "email" | "created" | "riskLevel">("name")
  const [userSortDirection, setUserSortDirection] = useState<SortDirection>("desc")
  const [selectedAppIds, setSelectedAppIds] = useState(new Set<string>());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isBulkUpdateInProgress, setIsBulkUpdateInProgress] = useState(false);

  const searchTerm = useDebounce(searchInput, 300)
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300)



  // Add sidebar state management
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentView, setCurrentView] = useState<string>("applications")

  const [authProvider, setAuthProvider] = useState<'google' | 'microsoft' | null>(null);

  // Sidebar handlers
  const handleSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  const handleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  const handleViewChange = (view: string) => {
    setCurrentView(view)
    if (view === "applications") {
      setMainView("list")
    } else if (view === "ai-risk-analysis") {
      // Route to the dedicated AI Risk Analysis page
      router.push("/ai-risk-analysis")
      return
    } else if (view === "organize-app-inbox") {
      // Route to the organize-app-inbox page
      router.push("/app-list")
      return
    } else if (view === "email-notifications") {
      // Route to the consolidated settings page
      router.push("/settings?view=email-notifications")
      return
    } else if (view === "organization-settings") {
      // Route to the consolidated settings page
      router.push("/settings?view=organization-settings")
      return
    } else if (view === "app-inbox-settings") {
      // Route to the consolidated settings page
      router.push("/settings?view=authentication")
      return
    }
    // Close sidebar on mobile after selection
    setIsSidebarOpen(false)
  }

  const [isPolling, setIsPolling] = useState(false)
  const [uncategorizedApps, setUncategorizedApps] = useState<Set<string>>(new Set())
  const [appCategories, setAppCategories] = useState<Record<string, string>>({})
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  const [userInfo, setUserInfo] = useState<{ name: string; email: string; avatar_url: string | null } | null>(null);

  // Add this state near your other useState declarations
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState<string>('');
  
  // State for the "Top Apps by User Count" chart's managed status filter
  const [chartManagedStatusFilter, setChartManagedStatusFilter] = useState<string>('Any Status');

  // State for the "High Risk Users by App" chart's managed status filter
  const [highRiskUsersManagedStatusFilter, setHighRiskUsersManagedStatusFilter] = useState<string>('Any Status');

  // State for the "Apps by Scope Permissions" chart's managed status filter
  const [scopePermissionsManagedStatusFilter, setScopePermissionsManagedStatusFilter] = useState<string>('Any Status');

  const searchParams = useSearchParams(); // Import and use useSearchParams
  const mainContentRef = useRef<HTMLDivElement>(null); // Added for scroll to top

  // Add state for AI risk data
  const [aiRiskData, setAiRiskData] = useState<any[]>([])
  // Pre-compute AI data mapping for faster deep dive performance
  const [aiDataMap, setAiDataMap] = useState<Map<string, any>>(new Map())
  // AI Risk Scoring detailed data for tabbed view
  const [aiRiskScoringData, setAiRiskScoringData] = useState<any[]>([])
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  // Add state for background AI score updates
  const [isUpdatingAIScores, setIsUpdatingAIScores] = useState(false)

  // This function is now more robust, accepting all data it needs as arguments
  // to avoid relying on state that might not be updated yet.
  const calculateAIRiskScore = (app: Application, aiData: any, currentOrgSettings: any): number | null => {
    if (!aiData) return null;

    // Define scoring criteria using the passed-in settings
    const scoringCriteria = {
      dataPrivacy: { weight: currentOrgSettings.bucketWeights.dataPrivacy, averageField: "Average 1" },
      securityAccess: { weight: currentOrgSettings.bucketWeights.securityAccess, averageField: "Average 2" },
      businessImpact: { weight: currentOrgSettings.bucketWeights.businessImpact, averageField: "Average 3" },
      aiGovernance: { weight: currentOrgSettings.bucketWeights.aiGovernance, averageField: "Average 4" },
      vendorProfile: { weight: currentOrgSettings.bucketWeights.vendorProfile, averageField: "Average 5" }
    };

    // Get AI status
    const aiStatus = aiData?.["AI-Native"]?.toLowerCase() || "";
    
    // Get scope risk from the actual app data
    const getCurrentScopeRisk = () => {
      if (app && app.riskLevel) {
        const riskLevel = transformRiskLevel(app.riskLevel);
        return riskLevel.toUpperCase();
      }
      return 'MEDIUM';
    };
    
    const currentScopeRisk = getCurrentScopeRisk();
    
    // Get scope multipliers from the passed-in settings
    const getScopeMultipliers = (scopeRisk: string) => {
      if (scopeRisk === 'HIGH') return currentOrgSettings.scopeMultipliers.high;
      if (scopeRisk === 'MEDIUM') return currentOrgSettings.scopeMultipliers.medium;
      return currentOrgSettings.scopeMultipliers.low;
    };

    const scopeMultipliers = getScopeMultipliers(currentScopeRisk);
    
    // Get AI multipliers from the passed-in settings
    const getAIMultipliers = (status: string) => {
      const lowerStatus = status.toLowerCase().trim();
      if (lowerStatus.includes("partial")) return currentOrgSettings.aiMultipliers.partial;
      if (lowerStatus.includes("no") || lowerStatus.includes("not applicable")) return currentOrgSettings.aiMultipliers.none;
      if (lowerStatus.includes("genai") || lowerStatus.includes("native") || lowerStatus.includes("yes")) return currentOrgSettings.aiMultipliers.native;
      return currentOrgSettings.aiMultipliers.none;
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
  };

  // Add states for owner email and notes editing
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  // Default organization settings for the OrganizationSettingsDialog
  const [orgSettings, setOrgSettings] = useState({
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
  });

  // Helper function to redirect to Google consent screen
  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      setLoginError(''); // Clear previous errors specifically for a new login attempt

      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      const redirectUri = 'https://www.manage.stitchflow.io/api/auth/google';

      if (!clientId) {
        setLoginError("Missing Google OAuth configuration");
        console.error('Missing client ID');
        setIsLoading(false);
        return;
      }

      console.log('Using redirectUri:', redirectUri);
      
      // Use minimal scopes initially - just enough to identify the user
      const scopes = [
        'openid',
        'profile',
        'email'
      ].join(' ');

      // Generate a state parameter to verify the response and enable cross-browser detection
      const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      
      // Always store in localStorage to identify this browser session
      localStorage.setItem('oauthState', state);
      localStorage.setItem('auth_provider', 'google');
      localStorage.setItem('lastLogin', Date.now().toString());
      localStorage.setItem('login_attempt_time', Date.now().toString());
      
      // Direct account selection - show the accounts dialog directly
      // This bypasses the initial email input screen
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('access_type', 'offline'); 
      authUrl.searchParams.append('include_granted_scopes', 'true');
      authUrl.searchParams.append('state', state);
      
      // Clean URL before redirecting
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has('error')) {
        cleanUrl.searchParams.delete('error');
        window.history.replaceState({}, document.title, cleanUrl.toString());
      }

      window.location.href = authUrl.toString();
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Failed to initialize login. Please try again.');
      setIsLoading(false);
    }
  };
  
  // Helper function to redirect to Microsoft consent screen
  const handleMicrosoftLogin = async () => {
    try {
      setIsLoading(true);
      setLoginError(''); // Clear previous errors specifically for a new login attempt

      const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
      const redirectUri = 'https://www.manage.stitchflow.io/api/auth/microsoft';

      if (!clientId) {
        setLoginError("Missing Microsoft OAuth configuration");
        console.error('Missing env variables:', { 
          clientId: clientId ? 'present' : 'missing',
          redirectUri: redirectUri ? 'present' : 'missing'
        });
        setIsLoading(false);
        return;
      }

      console.log('Using redirectUri:', redirectUri);
      
      const scopes = [
        // Start with minimal scopes; we'll request admin scopes later if needed
        'User.Read',
        'offline_access',
        'openid',
        'profile',
        'email'
      ].join(' ');

      // Generate a state parameter to verify the response and enable cross-browser detection
      const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      
      // Always store in localStorage to identify this browser session
      localStorage.setItem('oauthState', state);
      localStorage.setItem('auth_provider', 'microsoft');
      localStorage.setItem('lastLogin', Date.now().toString());
      localStorage.setItem('login_attempt_time', Date.now().toString());
      
      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('response_mode', 'query');
      authUrl.searchParams.append('prompt', 'select_account');
      authUrl.searchParams.append('state', state);

      // Clean URL before redirecting
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has('error')) {
        cleanUrl.searchParams.delete('error');
        window.history.replaceState({}, document.title, cleanUrl.toString());
      }

      window.location.href = authUrl.toString();
    } catch (err) {
      console.error('Microsoft login error:', err);
      setLoginError('Failed to initialize Microsoft login. Please try again.');
      setIsLoading(false);
    }
  };
  
  // Add a useEffect to check for error parameters in the URL
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const errorParam = searchParams.get('error');

    if (errorParam) {
      const provider = localStorage.getItem('auth_provider') as 'google' | 'microsoft' | null;

      const needsDirectConsentErrors = [
        'interaction_required',
        'login_required',
        'consent_required',
        'missing_data',
        'data_refresh_required'
      ];
      const isDirectConsentError = needsDirectConsentErrors.includes(errorParam);

      if (isDirectConsentError && provider) {
        console.log(`Redirecting directly to ${provider} consent screen due to error: ${errorParam}`);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('error');
        window.history.replaceState({}, document.title, cleanUrl.toString());

        if (provider === 'google') {
          handleGoogleLogin();
        } else if (provider === 'microsoft') {
          handleMicrosoftLogin();
        }
        return; // Exit after redirecting
      }

      let friendlyMessage = '';
        switch (errorParam) {
          case 'admin_required':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'not_workspace_account':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'not_work_account':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'no_code':
            friendlyMessage = "Authentication failed: Authorization code missing. Please try again. Check you mail for detailed error message.";
            break;
          case 'auth_failed':
            friendlyMessage = "Authentication failed. Please try again or reach out to contact@stitchflow.io if the issue persists.";
            break;
          case 'user_data_failed':
            friendlyMessage = "Failed to fetch user data after authentication. Please try again.";
            break;
          case 'config_missing':
            friendlyMessage = "OAuth configuration is missing. Please reach out to contact@stitchflow.io.";
            break;
          case 'data_refresh_required': // Also in needsDirectConsentErrors
            // If provider was missing, this message will be shown.
            friendlyMessage = "We need to refresh your account permissions. Please sign in again to grant access.";
            break;
          // Cases for interaction_required, login_required, consent_required, missing_data
          // are handled by the default block below if they were a 'isDirectConsentError' but provider was null.
          case 'interaction_required':
          case 'login_required':
          case 'consent_required':
          case 'missing_data':
          case 'unknown':
          default:
            if (isDirectConsentError) { // Error was a direct consent type, but provider was null (so no redirect)
              friendlyMessage = 'We need to refresh your data access. Please grant permission again.';
            } else {
              friendlyMessage = "An unknown authentication error occurred. Please try again.";
            }
            break;
        }
        
      setLoginError(friendlyMessage);
      setShowLoginModal(true);

      // Clean up the URL by removing the error parameter
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
      }
    }
  }, [searchParams, handleGoogleLogin, handleMicrosoftLogin, setLoginError, setShowLoginModal]);

  // Add new function to check categories
  const checkCategories = async () => {
    try {
      let categoryOrgId: string | null = null;
      
      // Only run client-side code in browser environment
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        categoryOrgId = urlParams.get('orgId');
        
        if (!categoryOrgId) {
          try {
            const cookies = document.cookie.split(';');
            const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
            if (orgIdCookie) {
              categoryOrgId = orgIdCookie.split('=')[1].trim();
            }
          } catch (cookieError) {
            console.error("Error parsing cookies:", cookieError);
          }
        }
        
        if (!categoryOrgId) return;
      } else {
        // Skip this function on the server
        return;
      }

      // Only fetch categories for uncategorized apps
      const uncategorizedIds = Array.from(uncategorizedApps);
      if (uncategorizedIds.length === 0) return;

      const response = await fetch(`/api/applications/categories?ids=${uncategorizedIds.join(',')}&orgId=${categoryOrgId}`);
      if (!response.ok) return;

      const data = await response.json();
      
      // Update only the categories state
      setAppCategories(prev => ({ ...prev, ...data }));
      
      // Remove categorized apps from uncategorized set
      setUncategorizedApps(prev => {
        const next = new Set(prev);
        Object.entries(data).forEach(([id, category]) => {
          if (category && category !== 'Unknown') {
            next.delete(id);
          }
        });
        return next;
      });
    } catch (error) {
      console.error("Error checking categories:", error);
    }
  };

  // Modify the polling effect to use checkCategories
  useEffect(() => {
    if (uncategorizedApps.size > 0) {
      pollingInterval.current = setInterval(checkCategories, 5000) as NodeJS.Timeout;
    } else {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    }
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, [uncategorizedApps]);

  // Modify fetchData to use AI risk cache with duplication prevention
  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      // Set timestamp for cache validation
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('lastAppsFetch', Date.now().toString());
      }
      
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
      
      if (!isAuthenticated()) {
        console.log('Not authenticated, showing login modal');
        setShowLoginModal(true);
        setApplications([]);
        setIsLoading(false);
        return;
      }

      // Fetch applications using optimized endpoint with fallback
      // SMART PAGINATION: Load first 5 pages immediately, then background load remaining
      let rawData: Application[] = [];
      let fromCache = false;
      let responseTime = 0;
      let totalCount = 0;
      
      try {
        console.log('[PERF] 🚀 Starting smart pagination load...');
        const startTime = Date.now();
        
        // Add cache-busting timestamp to ensure fresh data on each full load
        const cacheBuster = Date.now();
        
        // PHASE 1: Load first page to get total count (disable deduplication for full data)
        const firstPageResponse = await fetch(`/api/applications-v2?orgId=${fetchOrgIdValue}&limit=200&includeUsers=true&page=1&deduplicate=false&cb=${cacheBuster}`);
        
        if (firstPageResponse.ok) {
          const firstPageData = await firstPageResponse.json();
          rawData = firstPageData.applications || [];
          fromCache = firstPageData.fromCache || false;
          responseTime = firstPageData.responseTime || (Date.now() - startTime);
          
          // Get exact total count and hasMore from the new metadata structure
          const hasMore = firstPageData.metadata?.hasMore;
          const totalRecords = firstPageData.metadata?.totalRecords;
          console.log(`[PERF] ✅ First page loaded: ${rawData.length} apps, hasMore: ${hasMore}, totalRecords: ${totalRecords}`);
          
          // PHASE 2: Load first 4 more pages immediately (total 5 pages)
          const IMMEDIATE_PAGES = 5;
          const immediatePagePromises = [];
          
          for (let page = 2; page <= IMMEDIATE_PAGES && hasMore; page++) {
            const pagePromise = fetch(`/api/applications-v2?orgId=${fetchOrgIdValue}&limit=200&page=${page}&includeUsers=true&deduplicate=false&cb=${cacheBuster}`)
              .then(res => res.ok ? res.json() : null)
              .then(data => ({ page, data }))
              .catch(err => {
                console.warn(`[PERF] Error loading immediate page ${page}:`, err);
                return { page, data: null };
              });
            immediatePagePromises.push(pagePromise);
          }
          
          // Wait for immediate pages
          console.log(`[PERF] 📦 Loading pages 2-${IMMEDIATE_PAGES} immediately...`);
          const immediateResults = await Promise.all(immediatePagePromises);
          
          let stillHasMore = hasMore;
          let lastPage = 1;
          
          immediateResults.forEach(({ page, data }) => {
            if (data && data.applications) {
              rawData = [...rawData, ...data.applications];
              console.log(`[PERF] Page ${page}: +${data.applications.length} apps (total: ${rawData.length})`);
              stillHasMore = data.metadata?.hasMore || false;
              lastPage = Math.max(lastPage, page);
            }
          });
          
          console.log(`[PERF] ⚡ Immediate load complete: ${rawData.length} apps from ${lastPage} pages`);
          
          // Add deduplication check and logging for consistency
          const appIdCounts = new Map<string, number>();
          const appNameCounts = new Map<string, number>();
          
          rawData.forEach(app => {
            // Count by ID
            appIdCounts.set(app.id, (appIdCounts.get(app.id) || 0) + 1);
            
            // Count by name
            const name = app.name.toLowerCase().trim();
            appNameCounts.set(name, (appNameCounts.get(name) || 0) + 1);
          });
          
          // Check for duplicates
          const duplicateIds = Array.from(appIdCounts.entries()).filter(([id, count]) => count > 1);
          const duplicateNames = Array.from(appNameCounts.entries()).filter(([name, count]) => count > 1);
          
          if (duplicateIds.length > 0) {
            console.warn(`[CONSISTENCY] ⚠️ Found ${duplicateIds.length} duplicate app IDs:`, duplicateIds.map(([id, count]) => `${id}(${count}x)`));
          }
          
          if (duplicateNames.length > 0) {
            console.warn(`[CONSISTENCY] ⚠️ Found ${duplicateNames.length} duplicate app names:`, duplicateNames.map(([name, count]) => `${name}(${count}x)`));
          }
          
          console.log(`[CONSISTENCY] ✅ Immediate load: ${rawData.length} total apps, ${appIdCounts.size} unique IDs, ${appNameCounts.size} unique names`);
          
          // PHASE 3: Background load remaining pages (if any)
          if (stillHasMore) {
            console.log('[PERF] 🔄 Starting background load for remaining pages...');
            
            // Don't await this - let it run in background
            const backgroundLoad = async () => {
              let bgPage = lastPage + 1;
              let bgHasMore = true;
              let backgroundApps: Application[] = [];
              
              while (bgHasMore && bgPage <= 50) { // Safety limit of 50 pages max
                try {
                  const bgResponse = await fetch(`/api/applications-v2?orgId=${fetchOrgIdValue}&limit=200&page=${bgPage}&includeUsers=true&deduplicate=false&cb=${cacheBuster}`);
                  if (bgResponse.ok) {
                    const bgData = await bgResponse.json();
                    const bgApps = bgData.applications || [];
                    
                    if (bgApps.length > 0) {
                      backgroundApps = [...backgroundApps, ...bgApps];
                      console.log(`[PERF] 📱 Background page ${bgPage}: +${bgApps.length} apps (bg total: ${backgroundApps.length})`);
                      
                      // Update the applications state with background data (prevent duplicates)
                      setApplications(prev => {
                        // Create a Set of existing app IDs to prevent duplicates
                        const existingIds = new Set(prev.map(app => app.id));
                        
                        // Filter out any apps that already exist  
                        const newApps = bgApps.filter((app: any) => !existingIds.has(app.id)).map((app: any) => ({
                          ...app,
                          users: (app.users || []).map((user: any) => ({
                            ...user,
                            riskLevel: determineRiskLevel(user.scopes)
                          })),
                          aiRiskScore: null // Background apps will get AI scores applied later
                        }));
                        
                        const combined = [...prev, ...newApps];
                        console.log(`[PERF] 🔥 UI updated with background data: ${combined.length} total apps (${newApps.length} new, ${bgApps.length - newApps.length} duplicates filtered)`);
                        return combined;
                      });
                    }
                    
                    bgHasMore = bgData.metadata?.hasMore || false;
                    bgPage++;
                  } else {
                    console.warn(`[PERF] Background page ${bgPage} failed: ${bgResponse.status}`);
                    bgHasMore = false;
                  }
                } catch (bgError) {
                  console.warn(`[PERF] Background page ${bgPage} error:`, bgError);
                  bgHasMore = false;
                }
                
                // Small delay to not overwhelm the server
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              console.log(`[PERF] 🎯 Background load complete: ${backgroundApps.length} additional apps loaded`);
              
              // Apply AI risk scores to background-loaded apps
              if (backgroundApps.length > 0) {
                console.log('[AI_RISK] 🔄 Applying AI risk scores to background-loaded apps...');
                try {
                  const aiRiskResponse = await fetch('/api/ai-risk-analysis');
                  if (aiRiskResponse.ok) {
                    const result = await aiRiskResponse.json();
                    if (result.success && result.data && result.data.length > 0) {
                      // Create AI risk score map
                      const aiRiskScoreMap = new Map<string, number>();
                      result.data.forEach((aiRiskItem: any) => {
                        const appName = aiRiskItem.appName;
                        const finalScore = aiRiskItem.finalAppRiskScore;
                        if (appName && finalScore !== null && finalScore !== undefined) {
                          aiRiskScoreMap.set(appName, finalScore);
                          aiRiskScoreMap.set(appName.toLowerCase().trim(), finalScore);
                          const normalizedName = appName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                          if (normalizedName) {
                            aiRiskScoreMap.set(normalizedName, finalScore);
                          }
                        }
                      });
                      
                      // Update applications state with AI risk scores for background apps
                      setApplications(prev => {
                        let backgroundMatchedCount = 0;
                        const updated = prev.map(app => {
                          // Only update apps that don't have AI risk scores yet (background apps)
                          if (app.aiRiskScore === null) {
                            // Same matching logic as main load
                            let aiRiskScore: number | undefined = undefined;
                            
                            // Exact match
                            aiRiskScore = aiRiskScoreMap.get(app.name);
                            if (aiRiskScore === undefined) {
                              // Normalized match
                              const normalizedAppName = app.name.toLowerCase().trim();
                              aiRiskScore = aiRiskScoreMap.get(normalizedAppName);
                              if (aiRiskScore === undefined) {
                                // Super normalized match
                                const superNormalizedName = normalizedAppName.replace(/[^a-z0-9]/g, '');
                                if (superNormalizedName) {
                                  aiRiskScore = aiRiskScoreMap.get(superNormalizedName);
                                }
                                // Flexible contains-based search
                                if (aiRiskScore === undefined) {
                                  for (const [key, value] of aiRiskScoreMap.entries()) {
                                    const normalizedKey = key.toLowerCase().trim();
                                    if (normalizedKey.length > 3 && (
                                      normalizedAppName.includes(normalizedKey) || 
                                      normalizedKey.includes(normalizedAppName)
                                    )) {
                                      aiRiskScore = value;
                                      break;
                                    }
                                  }
                                }
                              }
                            }
                            
                            if (aiRiskScore !== undefined) {
                              backgroundMatchedCount++;
                              console.log(`[AI_RISK] 🎯 Background match: "${app.name}" -> ${aiRiskScore}`);
                              return { ...app, aiRiskScore };
                            }
                          }
                          return app;
                        });
                        
                        console.log(`[AI_RISK] ✅ Background AI matching complete: ${backgroundMatchedCount} apps matched`);
                        return updated;
                      });
                    }
                  }
                } catch (error) {
                  console.error('[AI_RISK] Failed to apply AI scores to background apps:', error);
                }
              }
              
              // Final consistency check after all loading is complete
              setTimeout(() => {
                setApplications(currentApps => {
                  console.log(`[CONSISTENCY] 🔍 Final app count: ${currentApps.length} total apps`);
                  
                  // Check for duplicates in final dataset
                  const finalIdCounts = new Map<string, number>();
                  const finalNameCounts = new Map<string, number>();
                  
                  currentApps.forEach(app => {
                    finalIdCounts.set(app.id, (finalIdCounts.get(app.id) || 0) + 1);
                    const name = app.name.toLowerCase().trim();
                    finalNameCounts.set(name, (finalNameCounts.get(name) || 0) + 1);
                  });
                  
                  const finalDuplicateIds = Array.from(finalIdCounts.entries()).filter(([id, count]) => count > 1);
                  const finalDuplicateNames = Array.from(finalNameCounts.entries()).filter(([name, count]) => count > 1);
                  
                  if (finalDuplicateIds.length > 0) {
                    console.warn(`[CONSISTENCY] ⚠️ Final duplicates by ID: ${finalDuplicateIds.length}`, finalDuplicateIds.slice(0, 5));
                  }
                  
                  if (finalDuplicateNames.length > 0) {
                    console.warn(`[CONSISTENCY] ⚠️ Final duplicates by name: ${finalDuplicateNames.length}`, finalDuplicateNames.slice(0, 5));
                  }
                  
                  console.log(`[CONSISTENCY] ✅ Final summary: ${currentApps.length} total, ${finalIdCounts.size} unique IDs, ${finalNameCounts.size} unique names`);
                  
                  return currentApps; // Return unchanged
                });
              }, 2000); // Wait 2 seconds after background load completes
            };
            
            // Start background loading without waiting
            backgroundLoad().catch(err => {
              console.warn('[PERF] Background loading failed:', err);
            });
          }
          
        } else {
          throw new Error(`First page load failed: ${firstPageResponse.status}`);
        }
      } catch (newEndpointError) {
        console.warn('[PERF] ⚠️ New endpoint failed, falling back to old endpoint:', newEndpointError);
        
        try {
          // Fallback to old endpoint
          const oldAppsResponse = await fetch(`/api/applications?orgId=${fetchOrgIdValue}`);
          if (!oldAppsResponse.ok) {
            throw new Error('Failed to fetch applications from both endpoints');
          }
          rawData = await oldAppsResponse.json();
          console.log(`[PERF] 🔄 Fallback successful: ${rawData.length} apps`);
        } catch (fallbackError) {
          console.error('[PERF] ❌ Both endpoints failed:', fallbackError);
          throw new Error('Failed to fetch applications from both old and new endpoints');
        }
      }

      // Get organization settings
      const orgSettingsResponse = await fetch(`/api/organization-settings?org_id=${fetchOrgIdValue}`);
      let fetchedOrgSettings = orgSettings; 
      if (orgSettingsResponse.ok) {
        const result = await orgSettingsResponse.json();
        if (result.settings) {
          fetchedOrgSettings = {
            bucketWeights: result.settings.bucket_weights,
            aiMultipliers: result.settings.ai_multipliers,
            scopeMultipliers: result.settings.scope_multipliers
          };
        }
      }

      // Fetch fresh AI data using the same endpoint as AI Risk Analysis page
      console.log('[DEBUG] Fetching fresh AI data from ai-risk-analysis endpoint...');
      
      try {
          console.log('[AI_RISK] 🎯 Fetching AI risk scores from optimized endpoint...');
          const aiRiskResponse = await fetch('/api/ai-risk-analysis');
          
          if (aiRiskResponse.ok) {
            const result = await aiRiskResponse.json();
            console.log(`[AI_RISK] Response status: success=${result.success}, dataCount=${result.data ? result.data.length : 0}`);
            console.log(`[AI_RISK] Response time: ${result.responseTime}ms, fromCache: ${result.fromCache}`);
            
            if (result.success && result.data && result.data.length > 0) {
              // Process AI data from ai-risk-analysis endpoint with enhanced matching
              const aiRiskScoreMap = new Map<string, number>();
              
              // Log sample data for debugging
              if (result.data.length > 0) {
                console.log(`[AI_RISK] Sample AI data:`, result.data.slice(0, 3).map((item: any) => ({
                  appName: item.appName,
                  finalScore: item.finalAppRiskScore
                })));
              }
              
              result.data.forEach((aiRiskItem: any) => {
                const appName = aiRiskItem.appName;
                const finalScore = aiRiskItem.finalAppRiskScore;
                if (appName && finalScore !== null && finalScore !== undefined) {
                  // Store with multiple key variations for maximum compatibility
                  aiRiskScoreMap.set(appName, finalScore);
                  aiRiskScoreMap.set(appName.toLowerCase().trim(), finalScore);
                  
                  // Also store with normalized variations for better matching
                  const normalizedName = appName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  if (normalizedName) {
                    aiRiskScoreMap.set(normalizedName, finalScore);
                  }
                }
              });

              console.log(`[AI_RISK] Created AI risk score map with ${aiRiskScoreMap.size} total entries`);
              console.log(`[AI_RISK] Available AI apps: ${Array.from(aiRiskScoreMap.keys()).slice(0, 10).join(', ')}...`);
              
              // Process applications with AI risk score matching
              let matchedCount = 0;
              let unmatchedApps: string[] = [];
              
              const processedData = rawData.map(app => {
                const appWithRiskLevels = {
                  ...app,
                  users: (app.users || []).map(user => ({
                    ...user,
                    riskLevel: determineRiskLevel(user.scopes)
                  }))
                };
                
                // AI score matching with multiple fallback methods
                let aiRiskScore: number | undefined = undefined;
                
                // Method 1: Exact match
                aiRiskScore = aiRiskScoreMap.get(app.name);
                if (aiRiskScore !== undefined) {
                  matchedCount++;
                  return { ...appWithRiskLevels, aiRiskScore };
                }
                
                // Method 2: Normalized match
                const normalizedAppName = app.name.toLowerCase().trim();
                aiRiskScore = aiRiskScoreMap.get(normalizedAppName);
                if (aiRiskScore !== undefined) {
                  matchedCount++;
                  return { ...appWithRiskLevels, aiRiskScore };
                }
                
                // Method 3: Super normalized match (alphanumeric only)
                const superNormalizedName = normalizedAppName.replace(/[^a-z0-9]/g, '');
                if (superNormalizedName) {
                  aiRiskScore = aiRiskScoreMap.get(superNormalizedName);
                  if (aiRiskScore !== undefined) {
                    matchedCount++;
                    return { ...appWithRiskLevels, aiRiskScore };
                  }
                }
                
                // Method 4: Flexible contains-based search
                for (const [key, value] of aiRiskScoreMap.entries()) {
                  const normalizedKey = key.toLowerCase().trim();
                  if (normalizedKey.length > 3 && (
                    normalizedAppName.includes(normalizedKey) || 
                    normalizedKey.includes(normalizedAppName)
                  )) {
                    matchedCount++;
                    return { ...appWithRiskLevels, aiRiskScore: value };
                  }
                }
                
                // No match found
                unmatchedApps.push(app.name);
                return { ...appWithRiskLevels, aiRiskScore: null };
              });
              
              console.log(`[AI_RISK] 📊 Matching results: ${matchedCount}/${rawData.length} apps matched with AI scores`);
              

              
              if (unmatchedApps.length > 0 && unmatchedApps.length <= 10) {
                console.log(`[AI_RISK] ❌ Unmatched apps: ${unmatchedApps.join(', ')}`);
              } else if (unmatchedApps.length > 10) {
                console.log(`[AI_RISK] ❌ ${unmatchedApps.length} unmatched apps (showing first 10): ${unmatchedApps.slice(0, 10).join(', ')}`);
              }
              
              // Update state with fresh data
              setApplications(processedData);
              setAiRiskData(result.data); // Use the processed data directly
              
              // Pre-compute AI data map for faster deep dive lookups using original data format
              const newAiDataMap = new Map<string, any>();
              result.data.forEach((aiRiskItem: any) => {
                const appName = aiRiskItem.appName;
                if (appName) {
                  // Convert back to the expected format for deep dive compatibility
                  const convertedData = {
                    'Tool Name': appName,
                    'AI-Native': aiRiskItem.category?.includes('native') ? 'GenAI native' : 
                                 aiRiskItem.category?.includes('partial') ? 'GenAI partial' : 'No GenAI',
                    'Average 1': aiRiskItem.rawAppRiskScore,
                    'Average 2': aiRiskItem.rawAppRiskScore, 
                    'Average 3': aiRiskItem.rawAppRiskScore,
                    'Average 4': aiRiskItem.rawAppRiskScore,
                    'Average 5': aiRiskItem.rawAppRiskScore
                  };
                  newAiDataMap.set(appName.toLowerCase().trim(), convertedData);
                }
              });
              setAiDataMap(newAiDataMap);
              
              setOrgSettings(fetchedOrgSettings);
              setOrganizationId(fetchOrgIdValue || null);
              
              // Set default sort based on AI scores availability
              const hasAIScores = processedData.some(app => app.aiRiskScore !== null && app.aiRiskScore !== undefined);
              
              if (hasAIScores) {
                // If we have AI scores, set sort to AI risk score high to low
                setSortColumn("aiRiskScore");
                setSortDirection("desc");
                console.log(`[SORT] ✅ AI scores available: ${matchedCount} apps with scores, setting default sort to AI Risk Score (high to low)`);
              } else {
                // If no AI scores, fall back to risk level high to low
                setSortColumn("riskLevel");
                setSortDirection("desc");
                console.log(`[SORT] ⚠️ No AI scores available, setting default sort to Risk Level (high to low)`);
              }
              
              // Performance logging for fresh data
              console.log(`[PERF] ✅ Complete load with AI risk scores: Apps ${responseTime}ms (cached: ${fromCache}), AI scores: ${result.responseTime}ms (cached: ${result.fromCache}), Total apps: ${processedData.length}, AI matched: ${matchedCount}`);
              
              setIsLoading(false);
            } else {
              // Handle case where AI data response was successful but empty
              console.warn('[AI_RISK] ⚠️ AI data response was successful but empty - processing apps without AI scores');
              console.warn('[AI_RISK] Response details:', { success: result.success, dataLength: result.data?.length, responseTime: result.responseTime });
              
              const processedDataWithoutAI = rawData.map(app => ({
                ...app,
                users: (app.users || []).map(user => ({
                  ...user,
                  riskLevel: determineRiskLevel(user.scopes)
                })),
                aiRiskScore: null
              }));
              
              setApplications(processedDataWithoutAI);
              setOrgSettings(fetchedOrgSettings);
              setOrganizationId(fetchOrgIdValue || null);
              
              // Set default sort - no AI scores available, use risk level
              setSortColumn("riskLevel");
              setSortDirection("desc");
              console.log(`[SORT] ⚠️ No AI scores available, setting default sort to Risk Level (high to low)`);
              
              setIsLoading(false);
            }
          } else {
            // Handle case where AI data response was not ok
            console.error('[AI_RISK] ❌ AI Risk Analysis endpoint error:', aiRiskResponse.status, aiRiskResponse.statusText);
            const errorText = await aiRiskResponse.text();
            console.error('[AI_RISK] Error details:', errorText);
            
            const processedDataWithoutAI = rawData.map(app => ({
              ...app,
              users: (app.users || []).map(user => ({
                ...user,
                riskLevel: determineRiskLevel(user.scopes)
              })),
              aiRiskScore: null
            }));
            
            setApplications(processedDataWithoutAI);
            setOrgSettings(fetchedOrgSettings);
            setOrganizationId(fetchOrgIdValue || null);
            
            // Set default sort - no AI scores available, use risk level
            setSortColumn("riskLevel");
            setSortDirection("desc");
            console.log(`[SORT] ⚠️ No AI scores available (API error), setting default sort to Risk Level (high to low)`);
            
            setIsLoading(false);
          }
        } catch (aiError) {
          console.error('[AI_RISK] ❌ Failed to fetch AI risk data:', aiError);
          
          const processedDataWithoutAI = rawData.map(app => ({
            ...app,
            users: (app.users || []).map(user => ({
              ...user,
              riskLevel: determineRiskLevel(user.scopes)
            })),
            aiRiskScore: null
          }));
            
            setApplications(processedDataWithoutAI);
            setOrgSettings(fetchedOrgSettings);
            setOrganizationId(fetchOrgIdValue || null);
            
            // Set default sort - no AI scores available, use risk level
            setSortColumn("riskLevel");
            setSortDirection("desc");
            console.log(`[SORT] ⚠️ No AI scores available (fetch error), setting default sort to Risk Level (high to low)`);
            
            setIsLoading(false);
      }

      // Handle uncategorized apps
      const unknownIds = new Set<string>();
      const currentApps = applications.length > 0 ? applications : rawData;
      currentApps.forEach((app: Application) => {
        if (app.category === 'Unknown') unknownIds.add(app.id);
      });
      setUncategorizedApps(unknownIds);
      
      // Background loading will be handled by the existing pagination logic
      
    } catch (error) {
      console.error("Error fetching application data:", error);
      setApplications([]);
      setIsLoading(false);
    }
  };

  // Add useEffect to trigger fetchData with navigation state reset
  useEffect(() => {
    // Reset state to prevent duplication from navigation
    setApplications([]); // Clear existing applications to prevent duplication
    setAiRiskData([]);   // Clear AI risk data
    setAiDataMap(new Map()); // Clear AI data map
    setIsLoading(true);  // Set loading state
    
    fetchData();
    
    // Cleanup function
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, []); // Empty dependency array means this runs once on mount
  
  // Add effect to handle page visibility changes (when coming back from other pages)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only refresh if we have applications but they seem stale
        if (applications.length > 0) {
          const now = Date.now();
          const lastFetch = localStorage.getItem('lastAppsFetch');
          const staleThreshold = 5 * 60 * 1000; // 5 minutes
          
          if (!lastFetch || (now - parseInt(lastFetch)) > staleThreshold) {
            fetchData();
          }
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [applications.length]);

  // Add error state if needed
  const [error, setError] = useState<string | null>(null);

  // Stop polling when all apps are categorized
  useEffect(() => {
    if (!isPolling && pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  }, [isPolling]);

  useEffect(() => {
    const provider = localStorage.getItem('auth_provider') as 'google' | 'microsoft' | null;
    setAuthProvider(provider);
  }, []);

  useEffect(() => {
    // Fetch user info directly from our new API endpoint
    const fetchUserData = async () => {
      try {
        const response = await fetch('/api/session-info');
        
        if (response.ok) {
          const userData = await response.json();
          setUserInfo(userData);
          console.log('User data fetched successfully:', userData);
        } else {
          console.error('Failed to fetch user data, status:', response.status);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };
    
    fetchUserData();
  }, []);

  const handleSignOut = () => {
    // Only run in browser environment
    if (typeof window !== 'undefined') {
      // Clear all cookies by setting them to expire in the past
      const allCookies = document.cookie.split(';');
      console.log('Cookies before clearing:', allCookies);
      
      // Specifically clear the critical cookies with all path/domain combinations
      const cookiesToClear = ['orgId', 'userEmail', 'accessToken', 'refreshToken'];
      const domains = [window.location.hostname, '', null, 'stitchflow.io', `.${window.location.hostname}`];
      const paths = ['/', '', '/', '', null];
      
      // Try all combinations to ensure cookies are cleared
      for (const cookieName of cookiesToClear) {
        for (const domain of domains) {
          for (const path of paths) {
            const domainStr = domain ? `; domain=${domain}` : '';
            const pathStr = path ? `; path=${path}` : '';
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}`;
          }
        }
      }
      
      // Also try to clear all cookies generically
      allCookies.forEach((cookie: string) => {
        const [name] = cookie.trim().split('=');
        if (name) {
          // Try with different domain/path combinations
          for (const domain of domains) {
            for (const path of paths) {
              const domainStr = domain ? `; domain=${domain}` : '';
              const pathStr = path ? `; path=${path}` : '';
              document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}`;
            }
          }
        }
      });
      
      // Clear local storage
      localStorage.clear();
      
      // Clear session storage too
      sessionStorage.clear();
      
      console.log('Cookies after clearing:', document.cookie);
      
      // Redirect and force refresh (using a timestamp to prevent caching)
      window.location.href = `/`;
    }
  };

  
  // Sorting function
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  // Get sort icon for column header
  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Memoize filtered applications
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      const matchesSearch = searchTerm === "" || 
      app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (app.category && app.category.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesRisk = filterRisk ? app.riskLevel === filterRisk : true
    const matchesManaged = filterManaged ? app.managementStatus === filterManaged : true
    // Use appCategories for filtering if available, otherwise fallback to app.category
    const effectiveCategory = appCategories[app.id] || app.category;
    const matchesCategory = filterCategory ? effectiveCategory === filterCategory : true

    return matchesSearch && matchesRisk && matchesManaged && matchesCategory
  })
  }, [applications, searchTerm, filterRisk, filterManaged, filterCategory, appCategories]) // Added appCategories to dependency array

  // Get unique categories for the filter dropdown
  const uniqueCategories = [...new Set(applications.map(app => appCategories[app.id] || app.category).filter((category): category is string => category !== null))].sort()

  // Sort applications
  const sortedApps = [...filteredApps].sort((a, b) => {
    // Helper for numeric comparison with direction
    const compareNumeric = (valA: number, valB: number) => {
      return sortDirection === "asc" ? valA - valB : valB - valA
    }

    // Helper for string comparison with direction
    const compareString = (a: string | null, b: string | null): number => {
      if (!a && !b) return 0
      if (!a) return -1
      if (!b) return 1
      return sortDirection === "asc" ? a.localeCompare(b) : b.localeCompare(a)
    }

    // Helper for date comparison with direction
    const compareDate = (valA: string, valB: string) => {
      const dateA = new Date(valA).getTime()
      const dateB = new Date(valB).getTime()
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA
    }

    // Risk level comparison helper
    const getRiskValue = (risk: string) => {
      switch (risk.toLowerCase()) {
        case "high":
          return 3
        case "medium":
          return 2
        case "low":
          return 1
        default:
          return 0
      }
    }

    switch (sortColumn) {
      case "name":
        return compareString(a.name, b.name)
      case "userCount":
        return compareNumeric(a.userCount, b.userCount)
      case "riskLevel":
        return compareNumeric(getRiskValue(a.riskLevel), getRiskValue(b.riskLevel))
      case "totalPermissions":
        return compareNumeric(a.totalPermissions, b.totalPermissions)
      case "managementStatus":
        return compareString(a.managementStatus, b.managementStatus)
      case "highRiskUserCount":
        // Use transformRiskLevel to normalize the riskLevel values during comparison
        const highRiskA = a.users.filter(u => transformRiskLevel(u.riskLevel) === "High").length;
        const highRiskB = b.users.filter(u => transformRiskLevel(u.riskLevel) === "High").length;
        return compareNumeric(highRiskA, highRiskB);
      case "aiRiskScore":
        // Handle null/undefined AI risk scores properly
        const scoreA = a.aiRiskScore;
        const scoreB = b.aiRiskScore;
        
        // If both are null/undefined, they're equal
        if ((scoreA === null || scoreA === undefined) && (scoreB === null || scoreB === undefined)) return 0;
        // If only A is null/undefined, put it at the end
        if (scoreA === null || scoreA === undefined) return 1;
        // If only B is null/undefined, put it at the end  
        if (scoreB === null || scoreB === undefined) return -1;
        
        // Both have values, sort normally
        return compareNumeric(scoreA, scoreB);
      default:
        // Default to sorting by risk level and then user count
        const riskDiff = compareNumeric(getRiskValue(a.riskLevel), getRiskValue(b.riskLevel))
        if (riskDiff !== 0) return riskDiff
        return compareNumeric(a.userCount, b.userCount)
    }
  })

  // Pagination logic
  const totalPages = Math.ceil(sortedApps.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentApps = sortedApps.slice(startIndex, endIndex)

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5 // Show at most 5 page numbers

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total pages are less than or equal to maxVisiblePages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (currentPage <= 3) {
        // Near the start
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        // Near the end
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        // Middle - show current page and neighbors
        pages.push('...')
        pages.push(currentPage - 1)
        pages.push(currentPage)
        pages.push(currentPage + 1)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  const selectedApp = selectedAppId ? applications.find((app) => app.id === selectedAppId) : null

  // Memoize filtered users
  const filteredUsers = useMemo(() => {
    return selectedApp?.users.filter(
      (user) =>
        user.name.toLowerCase().includes(debouncedUserSearchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(debouncedUserSearchTerm.toLowerCase()),
    ) || []
  }, [selectedApp, debouncedUserSearchTerm])

  // Sort users
  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      const compareString = (valA: string, valB: string) => {
        return userSortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }

      const compareDate = (valA: string | undefined, valB: string | undefined) => {
        // If either value is undefined, handle it
        if (!valA && !valB) return 0;
        if (!valA) return userSortDirection === "asc" ? -1 : 1;
        if (!valB) return userSortDirection === "asc" ? 1 : -1;
        
        const dateA = new Date(valA).getTime()
        const dateB = new Date(valB).getTime()
        return userSortDirection === "asc" ? dateA - dateB : dateB - dateA
      }

      switch (userSortColumn) {
        case "name":
          return compareString(a.name, b.name)
        case "email":
          return compareString(a.email, b.email)
        case "created":
          return compareDate(a.created_at, b.created_at)
        case "riskLevel": {
          // Create a more comprehensive mapping to handle all possible RiskLevel values
          const riskOrder: Record<string, number> = { 
            'Low': 1, 'low': 1, 'LOW': 1,
            'Medium': 2, 'medium': 2, 'MEDIUM': 2, 
            'High': 3, 'high': 3, 'HIGH': 3
          };
          
          // Use transformRiskLevel to normalize keys as needed
          return userSortDirection === "asc" 
            ? (riskOrder[transformRiskLevel(a.riskLevel)] || 0) - (riskOrder[transformRiskLevel(b.riskLevel)] || 0)
            : (riskOrder[transformRiskLevel(b.riskLevel)] || 0) - (riskOrder[transformRiskLevel(a.riskLevel)] || 0);
        }
        default:
          return 0
      }
    })
  }, [filteredUsers, userSortColumn, userSortDirection])

  // Pagination calculations
  const userStartIndex = (userCurrentPage - 1) * itemsPerPage
  const userEndIndex = userStartIndex + itemsPerPage
  const currentUsers = sortedUsers.slice(userStartIndex, userEndIndex)
  const totalUserPages = Math.ceil(sortedUsers.length / itemsPerPage)

  // Add after handleCloseUserModal
  const getUserPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5

    if (totalUserPages <= maxVisiblePages) {
      for (let i = 1; i <= totalUserPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (userCurrentPage <= 3) {
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalUserPages)
      } else if (userCurrentPage >= totalUserPages - 2) {
        pages.push('...')
        for (let i = totalUserPages - 3; i <= totalUserPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push('...')
        pages.push(userCurrentPage - 1)
        pages.push(userCurrentPage)
        pages.push(userCurrentPage + 1)
        pages.push('...')
        pages.push(totalUserPages)
      }
    }

    return pages
  }

  // Modify the checkAuth function to be more generic
  const isAuthenticated = () => {
    // Only access cookies in the browser
    if (typeof window === 'undefined') {
      return false; // On server, consider not authenticated
    }
    
    const cookies = document.cookie.split(';');
    
    // Trim the cookies and check for orgId and userEmail
    const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
    const userEmailCookie = cookies.find(cookie => cookie.trim().startsWith('userEmail='));
    
    // Use the same logic as in fetchData to also check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const urlOrgId = urlParams.get('orgId');
    
    // Consider authenticated if either cookies or URL param is present
    return !!(orgIdCookie && userEmailCookie) || !!urlOrgId;
  };

  console.log("isAuthenticated", isAuthenticated());

  const checkAuth = (action: () => void) => {
    if (!isAuthenticated()) {
      setShowLoginModal(true);
      return false;
    }
    
    action();
    return true;
  };

  // Modify click handlers for insights tab
  const handleViewInsights = () => {
    checkAuth(() => {
      setMainView("Insights");
      handleCloseUserModal();
    });
  };



  // Modify your click handlers to use checkAuth
  const handleSeeUsers = (appId: string, tab: string = "users") => {
    checkAuth(() => {
      setSelectedAppId(appId);
      setDefaultTab(tab);
      setIsUserModalOpen(true);
    });
  };

  // Handle closing user details
  const handleCloseUserModal = () => {
    setIsUserModalOpen(false)
    setSelectedAppId(null)
    setUserSearchTerm("")
    setDefaultTab("users")
  }

  // Handle status change
  const handleStatusChange = async (appId: string, newStatus: string) => {
    const appToUpdate = applications.find(app => app.id === appId);
    if (!appToUpdate) return;

    // Optimistically update the UI
    const originalApplications = [...applications]
    const updatedApplications = applications.map(app =>
      app.id === appId ? { ...app, managementStatus: newStatus as any } : app
    )
    setApplications(updatedApplications)

    try {
             // First, update the application in the main 'applications' table
       const patchResponse = await fetch(`/api/applications`, {
         method: 'PATCH',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           id: appId,
           managementStatus: newStatus,
         }),
       });

      if (!patchResponse.ok) {
        const errorData = await patchResponse.json();
        throw new Error(errorData.error || 'Failed to update status in main table');
      }

      // Then, sync this change to the 'organize_apps' table
      const shadowOrgId = getOrgIdFromCookieOrUrl();
      if (shadowOrgId) {
        const syncResponse = await fetch('/api/organize/apps/by-name', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appName: appToUpdate.name,
            managementStatus: newStatus,
            shadowOrgId: shadowOrgId,
          }),
        });

        if (!syncResponse.ok) {
          const errorData = await syncResponse.json();
          // Don't throw an error, just log it, as the primary update succeeded
          console.error('Failed to sync status to App Inbox:', errorData);
        }
      }

    } catch (error) {
      console.error('Error in handleStatusChange:', error);
      // Revert the UI changes on any failure
      setApplications(originalApplications)
      // Optionally, show a toast or notification to the user
    }
  }

  // Helper function to get orgId from cookies or URL
  const getOrgIdFromCookieOrUrl = (): string | null => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlOrgId = urlParams.get('orgId');
      if (urlOrgId) return urlOrgId;
      
      const cookies = document.cookie.split(';');
      const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
      if (orgIdCookie) return orgIdCookie.split('=')[1].trim();
    }
    return null;
  };

  // Helper function to group users by identical scope sets
  function getScopeGroups(app: Application | null) {
    if (!app) return []

    // Create a map of scope sets to users
    const scopeGroups = new Map<string, { scopes: string[]; users: AppUser[]; isAllScopes?: boolean }>()

    // First, create a group for all scopes from the application
    const allScopes = [...app.scopes].sort()
    scopeGroups.set("ALL_SCOPES", {
      scopes: allScopes,
      users: [], // This may be empty if no user has all permissions
      isAllScopes: true // Mark this as the special "All Possible Scopes" group
    })

    // Then group users by their specific scope sets
    app.users.forEach((user) => {
      // Sort scopes to ensure consistent grouping
      const sortedScopes = [...user.scopes].sort()
      const scopeKey = sortedScopes.join("|")

      if (!scopeGroups.has(scopeKey)) {
        scopeGroups.set(scopeKey, {
          scopes: sortedScopes,
          users: [],
        })
      }

      scopeGroups.get(scopeKey)?.users.push(user)
    })

    // Convert map to array for rendering
    // Sort by number of scopes (descending) so the full scope set appears first
    return Array.from(scopeGroups.values())
      .sort((a, b) => {
        // Always put the "All Scopes" group first
        if (a.isAllScopes) return -1;
        if (b.isAllScopes) return 1;
        // Then sort remaining groups by number of scopes
        return b.scopes.length - a.scopes.length;
      })
  }

  // Chart data preparation functions
  const getCategoryChartData = (): CategoryData[] => {
    const categoryMap = new Map<string, number>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      categoryMap.set(currentCategory, (categoryMap.get(currentCategory) || 0) + 1)
    })

    return Array.from(categoryMap.entries()).map(([name, value]) => ({
      name,
      value,
      color: getCategoryColor(name)
    }))
  }

  const getAppsUsersBarData = (): BarChartData[] => {
    const categoryMap = new Map<string, { apps: number; users: number }>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      if (!categoryMap.has(currentCategory)) {
        categoryMap.set(currentCategory, { apps: 0, users: 0 })
      }

      const data = categoryMap.get(currentCategory)!
      data.apps += 1
      data.users += app.userCount
    })

    return Array.from(categoryMap.entries()).map(([name, data]) => ({
      name,
      ...data,
    }))
  }

  // Update the getTop10AppsByUsers function to not truncate names
  const getTop10AppsByUsers = () => {
    const sorted = [...applications].sort((a, b) => b.userCount - a.userCount)
    return sorted.slice(0, 10).map((app) => ({
      name: app.name,
      value: app.userCount, // Keep value for chart compatibility
      color: getCategoryColor(appCategories[app.id] || app.category), // Use latest category color
    }))
  }

  // Get top 10 apps by permissions
  const getTop10AppsByPermissions = () => {
    // Filter by managed status if selected
    let filtered = applications;
    if (scopePermissionsManagedStatusFilter && scopePermissionsManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === scopePermissionsManagedStatusFilter);
    }
    
    // Sort by number of permissions (scope count)
    const sorted = [...filtered].sort((a, b) => b.totalPermissions - a.totalPermissions);
    
    return sorted.map((app) => ({
      name: app.name,
      value: app.totalPermissions,
      color: getCategoryColor(appCategories[app.id] || app.category),
    }));
  };

  const getTop5Apps = () => {
    return [...applications]
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 5)
      .map((app) => ({
        name: app.name,
        users: app.userCount,
      }))
  }

  const getRiskChartData = (): RiskData[] => {
    const riskMap = new Map<string, number>()

    applications.forEach((app) => {
      riskMap.set(app.riskLevel, (riskMap.get(app.riskLevel) || 0) + 1)
    })

    const riskColors: Record<string, string> = {
      Low: "#81C784",    // darker pastel green
      Medium: "#FFD54F", // darker pastel yellow
      High: "#EF5350",   // darker pastel red
    }

    return Array.from(riskMap.entries()).map(([name, value]) => ({
      name,
      value,
      color: riskColors[name],
    }))
  }

  // Get category distribution data for the pie chart
  const getCategoryDistributionData = () => {
    const categoryCount = new Map<string, number>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      categoryCount.set(currentCategory, (categoryCount.get(currentCategory) || 0) + 1)
    })

    const totalApps = applications.length

    return Array.from(categoryCount.entries()).map(([category, count]) => ({
      name: category,
      value: count,
      percentage: totalApps > 0 ? Math.round((count / totalApps) * 100) : 0,
      color: getCategoryColor(category)
    }))
  }

  // Update the getCategoryColor function for charts
  const getCategoryColor = (category: string | null): string => {
    if (!category) return "#CBD5E1"; // Default gray for null/undefined
    
    // Fixed color mapping for consistent colors with proper hex values instead of tailwind classes
    const colorMap: Record<string, string> = {
      "Analytics & Business Intelligence":   "#FBCFE8", // pink-200  :contentReference[oaicite:0]{index=0}
      "Cloud Platforms & Infrastructure":    "#C7D2FE", // indigo-200  :contentReference[oaicite:1]{index=1}
      "Customer Success & Support":          "#99F6E4", // teal-200  :contentReference[oaicite:2]{index=2}
      "Design & Creative Tools":             "#F5D0FE", // fuchsia-200  :contentReference[oaicite:3]{index=3}
      "Developer & Engineering Tools":       "#BFDBFE", // blue-200  :contentReference[oaicite:4]{index=4}
      "Finance & Accounting":                "#FDE68A", // amber-200  :contentReference[oaicite:5]{index=5}
      "Human Resources & People Management": "#D9F99D", // lime-200  :contentReference[oaicite:6]{index=6}
      "IT Operations & Security":            "#FECACA", // red-200   :contentReference[oaicite:7]{index=7}
      "Identity & Access Management":        "#DDD6FE", // violet-200  :contentReference[oaicite:8]{index=8}
      "Productivity & Collaboration":        "#A7F3D0", // emerald-200  :contentReference[oaicite:9]{index=9}
      "Project Management":                  "#FED7AA", // orange-200  :contentReference[oaicite:10]{index=10}
      "Sales & Marketing":                   "#A5F3FC", // cyan-200   :contentReference[oaicite:11]{index=11}
      Others:                                "#E5E7EB", // gray-200   :contentReference[oaicite:12]{index=12}
    };
    // Return the mapped color or a default
    return colorMap[category] || "#E2E8F0"; // Default slate-200 for unknown categories
  };

  // Generate monthly active users data
  const getMonthlyActiveUsers = () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    // Generate realistic data with higher values in summer months
    return months.map((month) => {
      let value
      if (["Jul", "Aug", "Sep", "Oct"].includes(month)) {
        // Summer/Fall months - higher engagement
        value = Math.floor(Math.random() * 25) + 65 // 65-90%
      } else if (["May", "Jun", "Nov", "Dec"].includes(month)) {
        // Late spring/early summer and winter - medium engagement
        value = Math.floor(Math.random() * 20) + 45 // 45-65%
      } else {
        // Winter/early spring - lower engagement
        value = Math.floor(Math.random() * 15) + 30 // 30-45%
      }

      return {
        name: month,
        value,
      }
    })
  }

  // App Icon component with improved fallbacks
  const AppIcon = ({ name, logoUrl, logoUrlFallback }: { 
    name: string; 
    logoUrl?: string;
    logoUrlFallback?: string;
  }) => {
    // Get the first letter of the app name
    const initial = name.charAt(0).toUpperCase();
    const [primaryLogoError, setPrimaryLogoError] = useState(false);
    const [fallbackLogoError, setFallbackLogoError] = useState(false);

    // Generate a consistent background color based on app name
    const getBackgroundColor = (appName: string) => {
      // Simple hash function to generate a consistent color
      const hash = appName.split('').reduce((acc, char) => {
        return char.charCodeAt(0) + ((acc << 5) - acc);
      }, 0);
      
      // Generate a pastel color using the hash
      const h = Math.abs(hash) % 360;
      return `hsl(${h}, 70%, 85%)`;
    };

    const bgColor = getBackgroundColor(name);

    // Use primary logo, fallback logo, or initial with colored background
    if (logoUrl && !primaryLogoError) {
      return (
        <div className="w-8 h-8 rounded-md overflow-hidden">
          <Image
            src={logoUrl}
            alt={`${name} logo`}
            width={32}
            height={32}
            className="object-contain"
            onError={() => setPrimaryLogoError(true)}
          />
        </div>
      );
    } else if (logoUrlFallback && !fallbackLogoError) {
      return (
        <div className="w-8 h-8 rounded-md overflow-hidden">
          <Image
            src={logoUrlFallback}
            alt={`${name} logo (fallback)`}
            width={32}
            height={32}
            className="object-contain"
            onError={() => setFallbackLogoError(true)}
          />
        </div>
      );
    } else {
      return (
        <div 
          className="flex items-center justify-center w-8 h-8 rounded-md text-gray-800 font-medium"
          style={{ backgroundColor: bgColor }}
        >
          {initial}
        </div>
      );
    }
  };

  // Update the getCategoryColor function in the CategoryBadge component
  const CategoryBadge = ({ category, appId, isCategorizing }: { category: string | null; appId: string; isCategorizing?: boolean }) => {
    // Use the latest category from appCategories if available, otherwise use the prop
    const currentCategory = appCategories[appId] || category;
    const isCurrentlyCategorizing = isCategorizing || (uncategorizedApps.has(appId) && (!currentCategory || currentCategory === 'Unknown'));

    if (isCurrentlyCategorizing) {
      return (
        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <div className="mr-1 h-2 w-2 rounded-full bg-blue-400 animate-pulse"></div>
          Categorizing...
        </div>
      );
    }

    if (!currentCategory) {
      return (
        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Uncategorized
        </div>
      );
    }

    const getCategoryBadgeColor = (category: string) => {
      // Use the same color mapping but for tailwind classes
      const colorMap: Record<string, string> = 
      {
        "Analytics & Business Intelligence":   "bg-pink-100     text-pink-600",
        "Cloud Platforms & Infrastructure":    "bg-indigo-100   text-indigo-600",
        "Customer Success & Support":          "bg-teal-100     text-teal-600",
        "Design & Creative Tools":             "bg-fuchsia-100  text-fuchsia-600",
        "Developer & Engineering Tools":       "bg-blue-100     text-blue-600",
        "Finance & Accounting":                "bg-amber-100    text-amber-600",
        "Human Resources & People Management": "bg-lime-100     text-lime-600",
        "IT Operations & Security":            "bg-red-100      text-red-600",
        "Identity & Access Management":        "bg-violet-100   text-violet-600",
        "Productivity & Collaboration":        "bg-emerald-100  text-emerald-600",
        "Project Management":                  "bg-orange-100   text-orange-600",
        "Sales & Marketing":                   "bg-cyan-100     text-cyan-600",
        Others:                                "bg-gray-100     text-gray-600",
      };
      return colorMap[category] || "bg-slate-100 text-slate-800";
    };

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryBadgeColor(currentCategory)} overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px] group-hover:max-w-none`}
            >
              {currentCategory}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="p-2 bg-gray-900 text-white rounded-md shadow-lg">
            <p className="text-xs">{currentCategory}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Update RiskBadge component to determine correct risk level from the user's scopes
  function RiskBadge({ level, scopes }: { level: string, scopes?: string[] }) {
    let riskLevel: RiskLevel;

    if (scopes && Array.isArray(scopes) && scopes.length > 0) {
      // Use the centralized risk assessment logic
      riskLevel = determineRiskLevel(scopes);
    } else {
      // For backward compatibility, transform the provided level
      riskLevel = transformRiskLevel(level);
    }
    
    // Normalize for display (e.g., "High", "Medium", "Low")
    const normalizedLevel = transformRiskLevel(riskLevel);
    
    const iconMap: Record<string, JSX.Element> = {
      Low: <CheckCircle className="h-5 w-5 mr-1 text-green-700" />,
      Medium: <AlertTriangle className="h-5 w-5 mr-1 text-yellow-700" />,
      High: <AlertTriangle className="h-5 w-5 mr-1 text-pink-700" />
    }

    const colorMap: Record<string, string> = {
      Low: "text-green-700 bg-green-50",
      Medium: "text-yellow-700 bg-yellow-50",
      High: "text-pink-700 bg-pink-50"
    }

    return (
      <div className={`flex items-center px-2 py-1 rounded-full ${colorMap[normalizedLevel] || colorMap.Low}`}>
        {iconMap[normalizedLevel] || iconMap.Low}
        <span>{normalizedLevel}</span>
      </div>
    )
  }

  // Date formatting function
  function formatDate(dateString: string | null | undefined): string {
    if (!dateString) {
      return 'N/A';
    }

    try {
      const date = new Date(dateString);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }

      // Format like "Mar 2, 2025, 1:29 AM"
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Error';
    }
  }

  // Handle user table sorting
  const handleUserSort = (column: "name" | "email" | "created" | "riskLevel") => {
    if (userSortColumn === column) {
      setUserSortDirection(userSortDirection === "asc" ? "desc" : "asc")
    } else {
      setUserSortColumn(column)
      setUserSortDirection("asc")
    }
  }

  // Get sort icon for user table column header
  const getUserSortIcon = (column: "name" | "email" | "created" | "riskLevel") => {
    if (userSortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return userSortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Add after getUserPageNumbers
  const getScopePageNumbers = (totalPages: number) => {
    const pages = []
    const maxVisiblePages = 5

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (scopeCurrentPage <= 3) {
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (scopeCurrentPage >= totalPages - 2) {
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push('...')
        pages.push(scopeCurrentPage - 1)
        pages.push(scopeCurrentPage)
        pages.push(scopeCurrentPage + 1)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  // Add before the return statement
  function getAppFunctionality(scopes: string[]): Set<string> {
    const functions = new Set<string>();
    scopes.forEach(scope => {
      if (scope.includes('drive') || scope.includes('docs')) {
        functions.add('document_collaboration');
      }
      if (scope.includes('calendar')) {
        functions.add('scheduling');
      }
      if (scope.includes('mail') || scope.includes('gmail')) {
        functions.add('communication');
      }
      if (scope.includes('sheets')) {
        functions.add('data_analysis');
      }
      if (scope.includes('slides')) {
        functions.add('presentation');
      }
      if (scope.includes('admin')) {
        functions.add('administration');
      }
      if (scope.includes('chat') || scope.includes('meet')) {
        functions.add('team_collaboration');
      }
    });
    return functions;
  }

  // Add after the getAppFunctionality function
  function getSimilarApps(currentApp: Application, allApps: Application[]): Array<{app: Application, score: number, reasons: string[]}> {
    return allApps
      .filter(app => app.id !== currentApp.id)
      .map(app => {
        // Create a temporary app object with updated category for similarity calculation
        const appWithCurrentCategory = {
          ...app,
          category: appCategories[app.id] || app.category
        };
        const currentAppWithUpdatedCategory = {
          ...currentApp,
          category: appCategories[currentApp.id] || currentApp.category
        };
        
        const score = calculateSimilarityScore(currentAppWithUpdatedCategory, appWithCurrentCategory);
        const reasons = getSimilarityReasons(currentAppWithUpdatedCategory, appWithCurrentCategory);
        return { app, score, reasons };
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  function calculateSimilarityScore(app1: Application, app2: Application): number {
    let score = 0;
    
    // User co-occurrence (50%)
    const sharedUsers = app1.users.filter(u1 => 
      app2.users.some(u2 => u2.email === u1.email)
    ).length;
    const userOverlapScore = Math.min(sharedUsers / Math.max(app1.users.length, app2.users.length, 1), 1) * 0.5;
    
    // Functional similarity (30%)
    const app1Functions = getAppFunctionality(app1.scopes);
    const app2Functions = getAppFunctionality(app2.scopes);
    const sharedFunctions = Array.from(app1Functions).filter(f => app2Functions.has(f)).length;
    const functionalScore = Math.min(sharedFunctions / Math.max(app1Functions.size, app2Functions.size, 1), 1) * 0.3;
    
    // Usage patterns (20%)
    // Only calculate if both apps have lastActive data
    let usageScore = 0.2; // Default score if we can't calculate
    
    score = userOverlapScore + functionalScore + usageScore;
    return score;
  }

  function getSimilarityReasons(app1: Application, app2: Application): string[] {
    const reasons: string[] = [];
    
    // Check user overlap
    const sharedUsers = app1.users.filter(u1 => 
      app2.users.some(u2 => u2.email === u1.email)
    ).length;
    if (sharedUsers > 0) {
      reasons.push(`${sharedUsers} shared users`);
    }
    
    // Check functional similarity
    const app1Functions = getAppFunctionality(app1.scopes);
    const app2Functions = getAppFunctionality(app2.scopes);
    const sharedFunctions = Array.from(app1Functions).filter(f => app2Functions.has(f));
    if (sharedFunctions.length > 0) {
      reasons.push(`Similar functionality: ${sharedFunctions.join(', ')}`);
    }
    
    // Check if they belong to the same category
    const category1 = app1.category;
    const category2 = app2.category;
    if (category1 && category2 && category1 === category2 && category1 !== 'Unknown') {
      reasons.push(`Same category: ${category1}`);
    }
    
    return reasons;
  }

  // Add after the getMonthlyActiveUsers function
  function getAppSimilarityNetwork() {
    // Create nodes for each app
    const nodes = applications.map(app => ({
      id: app.id,
      name: app.name,
      category: app.category,
      value: app.userCount, // Size based on user count
      color: getCategoryColor(app.category)
    }));

    // Create edges between similar apps
    const edges: Array<{source: string, target: string, value: number}> = [];
    
    applications.forEach(app1 => {
      const similarApps = getSimilarApps(app1, applications);
      similarApps.forEach(({ app: app2, score }) => {
        if (score > 0.3) { // Only show strong connections
          edges.push({
            source: app1.id,
            target: app2.id,
            value: score
          });
        }
      });
    });

    return { nodes, edges };
  }



  // Helper function to generate a random ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Helper function to transform user data
  const transformUser = (name: string, appId: string, scopes: string[]): AppUser => ({
    id: generateId(),
    appId,
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    scopes,
    riskLevel: determineRiskLevel(scopes),
    riskReason: "Based on scope permissions and usage patterns",
  });


    // Helper to convert app name to likely domain format
  function appNameToDomain(appName: string): string {
    // Common apps with special domain formats
    const knownDomains: Record<string, string> = {
      'slack': 'slack.com',
      'stitchflow': 'stitchflow.io',
      'yeshid': 'yeshid.com',
      'onelogin': 'onelogin.com',
      'google drive': 'drive.google.com',
      'google chrome': 'google.com',
      'accessowl': 'accessowl.com',
      'accessowl scanner': 'accessowl.com',
      'mode analytics': 'mode.com',
      'hubspot': 'hubspot.com',
      'github': 'github.com',
      'gmail': 'gmail.com',
      'zoom': 'zoom.us',
      'notion': 'notion.so',
      'figma': 'figma.com',
      'jira': 'atlassian.com',
      'confluence': 'atlassian.com',
      'asana': 'asana.com',
      'trello': 'trello.com',
      'dropbox': 'dropbox.com',
      'box': 'box.com',
      'microsoft': 'microsoft.com',
      'office365': 'office.com'
    };
    
    // Convert app name to lowercase for case-insensitive lookup
    const lowerAppName = appName.toLowerCase();
    
    // Check for exact matches in known domains
    if (knownDomains[lowerAppName]) {
      return knownDomains[lowerAppName];
    }
    
    // Check for partial matches (e.g., if app name contains known key)
    for (const [key, domain] of Object.entries(knownDomains)) {
      if (lowerAppName.includes(key)) {
        return domain;
      }
    }
    
    // Default processing for unknown apps
    // Remove special characters, spaces, and convert to lowercase
    const sanitized = lowerAppName
      .replace(/[^\w\s-]/gi, '')  // Keep hyphens as they're common in domains
      .replace(/\s+/g, '');
    
    // Default to .com instead of .io
    return sanitized + '.com';
  }

  function getAppLogoUrl(appName: string) {
    const domain = appNameToDomain(appName);
    
    // Try to get the app icon using Logo.dev
    const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
    
    // We could also provide a fallback URL using other icon services if needed
    // This gives us multiple ways to find a logo if the primary method fails
    const fallbackUrl = `https://icon.horse/icon/${domain}`;
    
    // Return both URLs so the frontend can try multiple sources
    return {
      primary: logoUrl,
      fallback: fallbackUrl
    };
  }

  // Function to transform the dummy data into our app's format
  const transformDummyData = (dummyData: any[]): Application[] => {
    return dummyData.map(item => {
      
      const id = generateId();
      const logoUrls = getAppLogoUrl(item.Apps);
      let appUsers = item.Users.map((user: string) => transformUser(user, id, item.Scopes));

      // Ensure some prominent dummy apps have high-risk users for UI demonstration
      if (item.Apps === "Slack" && appUsers.length > 0) {
        if (appUsers[0]) appUsers[0].riskLevel = "High";
        if (appUsers[1]) appUsers[1].riskLevel = "High"; // Ensure at least two for Slack if possible
      }
      if (item.Apps === "HubSpot" && appUsers.length > 0) {
        if (appUsers[0]) appUsers[0].riskLevel = "High";
      }
      if (item.Apps === "Looker Studio" && appUsers.length > 0) { // Another app that has "High" app risk
        if (appUsers[0]) appUsers[0].riskLevel = "High";
      }

      return {
        id,
        name: item.Apps,
        category: item.Category,
        userCount: appUsers.length,
        users: appUsers, // use the potentially modified appUsers
        riskLevel: item.Risk as RiskLevel,
        riskReason: "Based on scope permissions and usage patterns",
        totalPermissions: item["Total Scopes"],
        scopeVariance: { userGroups: Math.floor(Math.random() * 5) + 1, scopeGroups: Math.floor(Math.random() * 3) + 1 },
        managementStatus: item.Status as "Managed" | "Unmanaged" | "Newly discovered" | "Unknown" | "Ignore" | "Not specified",
        ownerEmail: "",
        logoUrl: logoUrls.primary,
        logoUrlFallback: logoUrls.fallback, // Assign fallback logo URL
        notes: "",
        scopes: item.Scopes,
        isInstalled: true,
        isAuthAnonymously: false
      };
    });
  };

  // Update the LoginModal component to fix both the top gap and maintain button spacing
  const LoginModal = ({ error }: { error: string }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [loginProvider, setLoginProvider] = useState<'google' | 'microsoft' | null>(null);
    const [currentLoginError, setCurrentLoginError] = useState(error); // Use prop for initial error
    const searchParams = useSearchParams();

    // Custom Reddit logo component - Moved from SignInDialog
    const RedditLogo = () => (
      <img src="/reddit-logo.svg" alt="Reddit Logo" width="20" height="20" className="text-orange-500" />
    );

    const testimonials = [
      {
        name: "u/ITLead",
        text: "Sharing this with my boss. Looks like great potential for our non-existent process haha",
      },
      {
        name: "u/sysadmin",
        text: "Nice tool. We're building something similar. The market need is real. Good luck to you <3",
      },
      {
        name: "u/ITManager",
        text: "This is nifty! I'm downloading it now. Do you plan to do updates/keep it current? Definitely going to mention this in my next position.",
      },
      {
        name: "u/sysengineer",
        text: "This tool will be a great help to IT admins for sure...!!",
      },
      {
        name: "u/CISO",
        text: "Quite nifty... there's quite a bit of customizing you can do. Thanks for sharing this for free.",
      },
      {
        name: "u/ITOpsMgr",
        text: "Very nice. Wish I had known about this a few months ago. I had our Salesforce admin build a contract tracker with similar functions a couple of months ago and now the finance team wants to use it to track their contracts.",
      },
    ];

    // Log data for debugging
    console.log("Login Modal Rendered, error state:", currentLoginError);
    console.log("URL Search Params:", Object.fromEntries(searchParams.entries()));

    useEffect(() => {
      setCurrentLoginError(error); // Update error when prop changes
    }, [error]);
    
    const handleGoogleLogin = async () => {
      try {
        setIsLoading(true);
        setLoginProvider('google');
        setCurrentLoginError(''); // Clear previous errors specifically for a new login attempt

        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        let redirectUri;

        if (!clientId) {
          setCurrentLoginError("Missing Google OAuth configuration");
          console.error('Missing client ID');
          setIsLoading(false);
          return;
        }

        // If we're on localhost, use the current origin
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
          redirectUri = `${window.location.origin}/api/auth/google/callback`;
        } else {
          redirectUri = 'https://stitchflow.io/api/auth/google';
        }
        
        console.log('Using redirectUri:', redirectUri);
        
        // Use minimal scopes initially - just enough to identify the user
        const scopes = [
          'openid',
          'profile',
          'email'
        ].join(' ');

        // Generate a state parameter to verify the response and enable cross-browser detection
        const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        
        // Always store in localStorage to identify this browser session
        localStorage.setItem('oauthState', state);
        localStorage.setItem('auth_provider', 'google');
        localStorage.setItem('lastLogin', Date.now().toString());
        localStorage.setItem('login_attempt_time', Date.now().toString());
        
        // Direct account selection - show the accounts dialog directly
        // This bypasses the initial email input screen
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', scopes);
        authUrl.searchParams.append('access_type', 'offline'); 
        authUrl.searchParams.append('include_granted_scopes', 'true');
        authUrl.searchParams.append('state', state);
        
        // Clean URL before redirecting
        const cleanUrl = new URL(window.location.href);
        if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        window.location.href = authUrl.toString();
      } catch (err) {
        console.error('Login error:', err);
        setCurrentLoginError('Failed to initialize login. Please try again.');
        setIsLoading(false);
        setLoginProvider(null);
      }
    };

    const handleMicrosoftLogin = async () => {
      try {
        setIsLoading(true);
        setLoginProvider('microsoft');
        setCurrentLoginError(''); // Clear previous errors specifically for a new login attempt

        const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
        let redirectUri = process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI;

        if (!clientId || !redirectUri) {
          setCurrentLoginError("Missing Microsoft OAuth configuration");
          console.error('Missing env variables:', { 
            clientId: clientId ? 'present' : 'missing',
            redirectUri: redirectUri ? 'present' : 'missing'
          });
          setIsLoading(false);
          setLoginProvider(null);
          return;
        }

        // If we're on localhost, update the redirect URI
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          redirectUri = window.location.origin + '/api/auth/microsoft';
        } else {
          redirectUri = 'https://www.manage.stitchflow.io/api/auth/microsoft';
        }
        
        console.log('Using redirectUri:', redirectUri);
        
        const scopes = [
          // Start with minimal scopes; we'll request admin scopes later if needed
          'User.Read',
          'offline_access',
          'openid',
          'profile',
          'email'
        ].join(' ');

        // Generate a state parameter to verify the response and enable cross-browser detection
        const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        
        // Always store in localStorage to identify this browser session
        localStorage.setItem('oauthState', state);
        localStorage.setItem('auth_provider', 'microsoft');
        localStorage.setItem('lastLogin', Date.now().toString());
        localStorage.setItem('login_attempt_time', Date.now().toString());
        
        const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', scopes);
        authUrl.searchParams.append('response_mode', 'query');
        authUrl.searchParams.append('prompt', 'select_account');
        authUrl.searchParams.append('state', state);

        // Clean URL before redirecting
        const cleanUrl = new URL(window.location.href);
        if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        window.location.href = authUrl.toString();
      } catch (err) {
        console.error('Microsoft login error:', err);
        setCurrentLoginError('Failed to initialize Microsoft login. Please try again.');
        setIsLoading(false);
        setLoginProvider(null);
      }
    };

    return (
              <Dialog open={showLoginModal} onOpenChange={isAuthenticated() ? setShowLoginModal : undefined}>
          <DialogContent className="sm:max-w-[900px] md:max-w-[1000px] p-0 overflow-hidden font-inter">
          <div className="grid gap-6 md:grid-cols-[1fr]">
            {/* Left side - Sign in */}
            <div className="space-y-8 p-8">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Sign in to continue</h2>
                <p className="text-sm text-muted-foreground">
                Connect with your org admin account to begin using the app
                </p>
              </div>

              {/* Error Message Display */}
              {currentLoginError && currentLoginError.length > 0 && (
                <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 rounded-md border border-red-200">
                  {currentLoginError}
                </div>
              )}

              <div className="space-y-6">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {isLoading && loginProvider === 'google' ? 'Connecting...' : 'Sign in with Google Workspace'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleMicrosoftLogin}
                  disabled={isLoading}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 23 23">
                    <path fill="#f3f3f3" d="M0 0h23v23H0z" />
                    <path fill="#f35325" d="M1 1h10v10H1z" />
                    <path fill="#81bc06" d="M12 1h10v10H12z" />
                    <path fill="#05a6f0" d="M1 12h10v10H1z" />
                    <path fill="#ffba08" d="M12 12h10v10H12z" />
                  </svg>
                  {isLoading && loginProvider === 'microsoft' ? 'Connecting...' : 'Sign in with Microsoft Workspace'}
                </Button>
              </div>

              <div className="space-y-3 pt-6">
                <div className="text-sm text-muted-foreground">

                  <p className="mt-2">
                  We take data privacy seriously. Learn more about our approach to{" "}
                    <a href="https://www.stitchflow.com/security" className="font-medium text-green-600 hover:underline">
                    security {" "}
                    </a>
                    or {" "}
                    <a href="https://www.stitchflow.com/demo" className="font-medium text-green-600 hover:underline">
                    schedule a time
                    </a>{" "}
                    to chat with us
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // Add a useEffect to force re-rendering the charts when in Insights view after new categories arrive
  useEffect(() => {
    // This effect will trigger whenever appCategories or mainView changes
    // No action needed - just having this dependency will cause charts to re-render
  }, [appCategories, mainView]);

  // We're now using the centralized risk assessment functions from '@/lib/risk-assessment'
  // instead of having duplicate risk assessment logic here

  // Apps by User Count - show all apps and filter by managed status
  const getAppsByUserCountChartData = () => {
    let filtered = applications;
    if (chartManagedStatusFilter && chartManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === chartManagedStatusFilter);
    }
    const sorted = [...filtered].sort((a, b) => b.userCount - a.userCount);
    return sorted.map((app) => ({
      name: app.name,
      value: app.userCount,
      color: getCategoryColor(appCategories[app.id] || app.category), // Ensure this provides a valid color string
    }));
  };

  // High Risk Users by App - chart data preparation
  const getHighRiskUsersByApp = () => {
    // Filter by managed status if selected
    let filtered = applications;
    if (highRiskUsersManagedStatusFilter && highRiskUsersManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === highRiskUsersManagedStatusFilter);
    }
    
    // Map applications to get name, high-risk user count, and color
    const mappedData = filtered.map(app => ({
      name: app.name,
      value: app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length,
      color: getCategoryColor(appCategories[app.id] || app.category),
    }));
    
    // Sort by number of high-risk users (descending)
    return mappedData.sort((a, b) => b.value - a.value);
  };

  // Update the states when an app is selected
  useEffect(() => {
    if (selectedApp) {
      setOwnerEmail(selectedApp.ownerEmail || "");
      setNotes(selectedApp.notes || "");
    }
  }, [selectedApp]);

  // Function to save owner email and notes
  const handleSaveNotesAndOwner = async () => {
    if (!selectedApp) return;

    try {
      setIsSaving(true);
      setSaveMessage(null);

      const response = await fetch('/api/applications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: selectedApp.id,
          ownerEmail,
          notes,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update application');
      }

      // Update applications state with the updated app
      setApplications(prevApps => {
        // Create a new array with the updated application
        const updatedApps = prevApps.map(app => 
          app.id === selectedApp.id 
            ? { ...app, ownerEmail, notes } 
            : app
        );
        
        return updatedApps;
      });

      // No need to update selectedAppId as it would trigger a re-render and potentially close the modal

      setSaveMessage({
        type: "success",
        text: "Successfully saved changes"
      });

      // Hide the success message after 3 seconds
      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (error) {
      console.error('Error saving notes and owner:', error);
      setSaveMessage({
        type: "error",
        text: "Failed to save changes. Please try again."
      });
    } finally {
      setIsSaving(false);
    }
  };

  // If not authenticated, only show login modal
  if (!isAuthenticated()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Dialog open={showLoginModal} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden font-inter">
            <div className="space-y-8 p-8">
              <div className="text-center">
                <h1 className="text-2xl font-bold">Sign in to continue</h1>
                <p className="mt-2 text-gray-600">Connect with your org admin account to begin using the app</p>
              </div>

              {/* Error Message Display */}
              {loginError && loginError.length > 0 && (
                <div className="mb-4 p-3 text-sm text-red-700 bg-red-100 rounded-md border border-red-200">
                  {loginError}
                </div>
              )}

              <div className="space-y-4">
                <button
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {isLoading ? 'Signing in...' : 'Sign in with Google Workspace'}
                </button>

                <button
                  onClick={handleMicrosoftLogin}
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#f25022" d="M1 1h10v10H1z"/>
                    <path fill="#00a4ef" d="M13 1h10v10H13z"/>
                    <path fill="#7fba00" d="M1 13h10v10H1z"/>
                    <path fill="#ffb900" d="M13 13h10v10H13z"/>
                  </svg>
                  {isLoading ? 'Signing in...' : 'Sign in with Microsoft Workspace'}
                </button>
              </div>

              <div className="text-center text-sm text-gray-500">
                We take data privacy seriously. Learn more about our approach to{' '}
                <a href="https://www.stitchflow.com/security" className="text-green-600 hover:underline">security</a> or{' '}
                <a href="https://www.stitchflow.com/demo" className="text-green-600 hover:underline">schedule a time</a> to chat with us
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const handleSelection = (index: number, appId: string, isShiftClick: boolean) => {
    const newSelectedIds = new Set(selectedAppIds);

    if (isShiftClick && lastSelectedIndex !== null) {
        // For shift-click, we select the range from the last-clicked to the current-clicked item.
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
            newSelectedIds.add(currentApps[i].id);
        }
    } else {
        // For a regular click, we toggle the item's selection state.
        if (newSelectedIds.has(appId)) {
            newSelectedIds.delete(appId);
        } else {
            newSelectedIds.add(appId);
        }
        // And we set the last-clicked index for future shift-clicks.
        setLastSelectedIndex(index);
    }
    
    setSelectedAppIds(newSelectedIds);
  };

  const handleSelectAll = (isSelected: boolean) => {
    if (isSelected) {
      // Select all apps currently visible on the page
      setSelectedAppIds(new Set(currentApps.map((app: Application) => app.id)));
    } else {
      // Deselect all
      setSelectedAppIds(new Set());
    }
  };

  const handleBulkUpdate = async (newStatus: string) => {
    if (selectedAppIds.size === 0 || !newStatus) return;

    setIsBulkUpdateInProgress(true);
    const originalApplications = [...applications];

    // Optimistic UI update
    const updatedApplications = applications.map(app => 
      selectedAppIds.has(app.id) ? { ...app, managementStatus: newStatus as any } : app
    );
    setApplications(updatedApplications);

    try {
      const response = await fetch('/api/applications/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appIds: Array.from(selectedAppIds),
          managementStatus: newStatus,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Bulk update failed:', errorData);
        throw new Error('Bulk update failed');
      }

      // On success, clear the selection
      setSelectedAppIds(new Set());
    } catch (error) {
      console.error('Error during bulk update:', error);
      // Revert UI changes on failure
      setApplications(originalApplications);
      alert('Failed to update applications. Please try again.');
    } finally {
      setIsBulkUpdateInProgress(false);
    }
  };

  const sortedAndFilteredApps = useMemo(() => {
    return filteredApps.slice(startIndex, endIndex);
  }, [filteredApps, startIndex, endIndex]);

  return (
    <div className="min-h-screen font-sans text-gray-900 bg-[#f8f5f3]">
      {/* Sidebar - only show when authenticated */}
      {isAuthenticated() && (
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
      )}

      <main className={`min-h-screen bg-white transition-all duration-300 ${
        isAuthenticated() 
          ? `${isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'}` 
          : ''
      }`}>
        <div className="h-screen overflow-y-auto">
          <div className="px-6 py-3">


            <div className="flex items-center gap-2 mb-3">
              {/* Mobile menu button - only show when authenticated */}
              {isAuthenticated() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSidebarToggle}
                  className="lg:hidden mr-2 p-1.5 hover:bg-gray-100"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              )}
              <h2 className="text-xl font-bold">
                {currentView === "app-inbox-settings" ? "Authentication" : 
                 "Shadow IT Overview"}
              </h2>
              {/* AI Score Update Indicator */}
              {isUpdatingAIScores && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                  <span className="text-xs text-blue-700 font-medium">Updating AI scores...</span>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="p-6 flex justify-center items-center min-h-[400px]">
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                    <p>Loading application data...</p>
                  </div>
                </div>
              </div>
            ) : !selectedAppId ? (
              <div ref={mainContentRef} className="space-y-6"> {/* Added ref here */}
                <div className="flex justify-between items-center mt-[-4px]">
                  <div>
                    <p className="text-lg font-medium text-gray-800">
                      {(() => {
                        // Count how many filters are active
                        const activeFilters = [filterCategory, filterRisk, filterManaged].filter(Boolean).length;
                        
                        if (activeFilters === 0) {
                          return `We found ${sortedApps.length} applications.`;
                        }

                        // Single filter messages
                        if (activeFilters === 1) {
                          if (filterCategory) {
                            return `We found ${sortedApps.length} applications in ${filterCategory}.`;
                          }
                          if (filterRisk) {
                            return `We found ${sortedApps.length} ${filterRisk.toLowerCase()} risk applications.`;
                          }
                          if (filterManaged) {
                            return `We found ${sortedApps.length} ${filterManaged.toLowerCase()} applications.`;
                          }
                        }

                        // Multiple filters - show total count with "filtered"
                        return `We found ${sortedApps.length} filtered applications.`;
                      })()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant={mainView === "list" ? "default" : "outline"} 
                      onClick={() => {
                        setMainView("list");
                        setCurrentView("applications");
                        handleCloseUserModal();
                      }}
                      className={mainView === "list" ? "bg-gray-900 hover:bg-gray-800" : ""}
                    >
                      <LayoutGrid className="h-4 w-4 mr-2" />
                      Applications
                    </Button>
                    <Button 
                      variant={mainView === "Insights" ? "default" : "outline"} 
                      onClick={() => {
                        if (checkAuth(() => {
                          setMainView("Insights");
                          handleCloseUserModal();
                        })) {
                          // If authenticated, update immediately
                          setMainView("Insights");
                          handleCloseUserModal();
                        }
                      }}
                      className={mainView === "Insights" ? "bg-gray-900 hover:bg-gray-800" : ""}
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Insights
                    </Button>

                  </div>
                </div>

                {mainView === "list" ? (
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                    <div className="p-6">
                      {/* Filter section */}
                      <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
                        <div className="flex-1 mt-1">
                          <div className="flex justify-between items-center mb-1">
                            <Label htmlFor="search" className="text-sm font-medium text-gray-700">
                            Search Applications
                          </Label>
                            {searchInput && (
                              <button
                                onClick={() => setSearchInput("")}
                                className="text-xs text-primary hover:text-primary/80 transition-colors"
                              >
                                Clear search
                              </button>
                            )}
                          </div>
                          <Input
                            id="search"
                            placeholder="Search by name or category..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="mt-1 border-gray-200"
                          />
                        </div>
                        
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="min-w-[150px]">
                            <div className="flex justify-between items-center mb-1">
                              <Label className="text-sm font-medium text-gray-700">Category</Label>
                              {filterCategory && (
                                <button
                                  onClick={() => setFilterCategory(null)}
                                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                            <select
                              className="w-full min-w-[300px] h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 truncate"
                              value={filterCategory || ""}
                              onChange={(e) => {
                                if (!isAuthenticated()) {
                                  setShowLoginModal(true);
                                  return;
                                }
                                setFilterCategory(e.target.value || null);
                              }}
                            >
                              <option value="">All Categories</option>
                              {uniqueCategories.map((category) => (
                                <option key={category} value={category} className="truncate">
                                  {category}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                            <div className="min-w-[150px]">
                              <div className="flex justify-between items-center mb-1">
                                <Label className="text-sm font-medium text-gray-700">Scope Risk</Label>
                                {filterRisk && (
                                  <button
                                    onClick={() => setFilterRisk(null)}
                                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                                  >
                                    Clear filter
                                  </button>
                                )}
                              </div>
                              <select
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                                value={filterRisk || ""}
                                onChange={(e) => setFilterRisk(e.target.value || null)}
                              >
                                <option value="">All Risk Levels</option>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                              </select>
                            </div>
                          
                          <div className="min-w-[150px]">
                            <div className="flex justify-between items-center mb-1">
                              <Label className="text-sm font-medium text-gray-700">Managed Status</Label>
                              {filterManaged && (
                                <button
                                  onClick={() => setFilterManaged(null)}
                                  className="text-xs text-primary hover:text-primary/80 transition-colors ml-2"
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                            <select
                              className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                              value={filterManaged || ""}
                              onChange={(e) => setFilterManaged(e.target.value || null)}
                            >
                              <option value="">All Statuses</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Newly discovered">Newly discovered</option>
                              <option value="Unknown">Unknown</option>
                              <option value="Ignore">Ignore</option>
                              <option value="Not specified">Not specified</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                        {selectedAppIds.size > 0 && (
                          <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              {selectedAppIds.size} app{selectedAppIds.size > 1 ? 's' : ''} selected
                            </span>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Managed Status:
                              </span>
                              <Select onValueChange={handleBulkUpdate} disabled={isBulkUpdateInProgress}>
                                <SelectTrigger className="w-[180px] h-9">
                                  <SelectValue placeholder="Change status..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Managed">Managed</SelectItem>
                                  <SelectItem value="Unmanaged">Unmanaged</SelectItem>
                                  <SelectItem value="Newly discovered">Newly discovered</SelectItem>
                                  <SelectItem value="Unknown">Unknown</SelectItem>
                                  <SelectItem value="Ignore">Ignore</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="sm" onClick={() => setSelectedAppIds(new Set())} disabled={isBulkUpdateInProgress}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                        <Table>
                            <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                              <TableRow className="border-b border-gray-100">
                                <TableHead className={`rounded-tl-lg bg-transparent`}>
                                  <div className="flex items-center gap-3">
                                    <Checkbox
                                      onCheckedChange={handleSelectAll}
                                      checked={currentApps.length > 0 && selectedAppIds.size === currentApps.length}
                                      // @ts-ignore
                                      indeterminate={selectedAppIds.size > 0 && selectedAppIds.size < currentApps.length}
                                      aria-label="Select all rows on this page"
                                    />
                                    <div className="flex items-center cursor-pointer" onClick={() => handleSort("name")}>
                                      Application
                                      {getSortIcon("name")}
                                    </div>
                                  </div>
                                </TableHead>
                                <TableHead className={`text-center cursor-pointer`} onClick={() => handleSort("userCount")}>
                                  <div className="flex items-center justify-center">
                                    Users
                                    {getSortIcon("userCount")}
                                  </div>
                                </TableHead>
                                
                                  
                                    <TableHead className="text-center cursor-pointer" onClick={() => handleSort("riskLevel")}>
                                      <div className="flex items-center justify-center">
                                       Scope Risk
                                        {getSortIcon("riskLevel")}
                                      </div>
                                    </TableHead>
                                    <TableHead
                                      className="text-center cursor-pointer"
                                      onClick={() => handleSort("totalPermissions")}
                                    >
                                      <div className="flex items-center justify-center">
                                        Total Scope Permissions
                                        {getSortIcon("totalPermissions")}
                                      </div>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => handleSort("highRiskUserCount")}>
                                      <div className="flex items-center justify-center">
                                        High Risk Users
                                        {getSortIcon("highRiskUserCount")}
                                      </div>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => handleSort("aiRiskScore")}>
                                      <div className="flex items-center justify-center">
                                        AI Risk Score
                                        {getSortIcon("aiRiskScore")}
                                      </div>
                                    </TableHead>
                                
                                <TableHead className={`cursor-pointer`} onClick={() => handleSort("managementStatus")}>
                                  <div className="flex items-center">
                                  Managed Status
                                    {getSortIcon("managementStatus")}
                                  </div>
                                </TableHead>
                                <TableHead className={`text-center rounded-tr-lg`}>User Scope Analysis</TableHead>
                              </TableRow>
                            </TableHeader>
                          <TableBody>
                              {currentApps.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                                  No applications found matching your filters
                                </TableCell>
                              </TableRow>
                            ) : (
                                currentApps.map((app, index) => (
                                  <TableRow 
                                    key={app.id}
                                    data-state={selectedAppIds.has(app.id) ? 'selected' : 'unselected'}
                                    className={`data-[state=selected]:bg-blue-50/50 dark:data-[state=selected]:bg-blue-500/10 ${
                                      index === currentApps.length - 1 ? "last-row" : ""
                                    }`}
                                  >
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <Checkbox
                                        onClick={(e) => handleSelection(index, app.id, e.shiftKey)}
                                        checked={selectedAppIds.has(app.id)}
                                        aria-label={`Select row for ${app.name}`}
                                      />
                                      <AppIcon name={app.name} logoUrl={app.logoUrl} logoUrlFallback={app.logoUrlFallback} />
                                      <div 
                                        className="cursor-pointer hover:text-primary transition-colors"
                                        onClick={() => handleSeeUsers(app.id)}
                                      >
                                        <div className="font-medium truncate max-w-[200px]">
                                          {app.name}
                                        </div>
                                        <div className="mt-1">
                                          <CategoryBadge 
                                            category={app.category} 
                                            appId={app.id} 
                                            isCategorizing={uncategorizedApps.has(app.id)} 
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                      <TooltipProvider>
                                        <Tooltip delayDuration={300}>
                                          <TooltipTrigger asChild>
                                    <div 
                                      className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                                      onClick={() => handleSeeUsers(app.id)}
                                    >
                                      <div className="flex -space-x-2">
                                        {app.users.slice(0, 3).map((user, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 border-2 border-background text-xs font-medium"
                                          >
                                            {getInitials(user.name)}
                                          </div>
                                        ))}
                                        {app.userCount > 3 && (
                                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 border-2 border-background text-xs font-medium">
                                            +{app.userCount - 3}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="p-2">
                                            <div className="max-h-48 overflow-y-auto space-y-1">
                                              {app.users.map((user, idx) => (
                                                <p key={idx} className="text-sm">{user.name}</p>
                                              ))}
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                  </TableCell>
                                  
                            
                                  <TableCell>
                                        <TooltipProvider>
                                            <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div className="flex items-center justify-center cursor-pointer" onClick={() => handleSeeUsers(app.id)}>
                                                <RiskBadge level={app.riskLevel} />
                                              </div>
                                            </TooltipTrigger>
                                              <TooltipContent side="right" className="p-2">
                                                <p className="text-sm">{app.riskReason}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <TooltipProvider>
                                            <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div className="text-center cursor-pointer" onClick={() => handleSeeUsers(app.id)}>{app.totalPermissions}</div>
                                            </TooltipTrigger>
                                              <TooltipContent side="right" className="p-2">
                                                <div className="max-h-48 overflow-y-auto space-y-1">
                                                  {app.scopes.map((scope, idx) => (
                                                    <p key={idx} className="text-sm">{scope}</p>
                                                  ))}
                                                </div>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                      </TableCell>    
                                    
                                      <TableCell className="text-center">
                                        <TooltipProvider>
                                          <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div 
                                                className="text-center cursor-pointer flex items-center justify-center" 
                                                onClick={() => handleSeeUsers(app.id)}
                                              >
                                                {app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length}
                                                
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="p-2">
                                              <p className="text-sm">
                                                {app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length} users with high risk level
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>

                                      <TableCell className="text-center">
                                        <TooltipProvider>
                                          <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div 
                                                className="text-center cursor-pointer flex items-center justify-center" 
                                                onClick={() => handleSeeUsers(app.id, "ai-risk-scoring")}
                                              >
                                                {app.aiRiskScore !== null && app.aiRiskScore !== undefined ? 
                                                  <span className="font-medium text-blue-600">{app.aiRiskScore.toFixed(1)}</span> : 
                                                  <span className="text-gray-400">N/A</span>
                                                }
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="p-2">
                                              <p className="text-sm">
                                                {app.aiRiskScore !== null && app.aiRiskScore !== undefined ? 
                                                  `AI Risk Score: ${app.aiRiskScore.toFixed(2)} (calculated from AI data + org settings)` : 
                                                  'No AI risk data available for this application'
                                                }
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>

                                  <TableCell>
                                    <select
                                      className="w-full min-w-[11rem] h-8 rounded-md border border-gray-200 bg-white px-2 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                                      value={editedStatuses[app.id] || app.managementStatus}
                                      onChange={(e) => {
                                        if (checkAuth(() => {
                                          handleStatusChange(app.id, e.target.value);
                                        })) {
                                          // If authenticated, update the UI immediately
                                          setEditedStatuses(prev => ({
                                            ...prev,
                                            [app.id]: e.target.value
                                          }));
                                        }
                                      }}
                                    >
                                      <option value="Managed">Managed</option>
                                      <option value="Unmanaged">Unmanaged</option>
                                      <option value="Newly discovered">Newly discovered</option>
                                      <option value="Unknown">Unknown</option>
                                      <option value="Ignore">Ignore</option>
                                      <option value="Not specified">Not specified</option>
                                    </select>
                                  </TableCell>
                                  <TableCell>
                                      <Button
                                      onClick={() => handleSeeUsers(app.id)}
                                        variant="outline"
                                        size="sm"
                                        className="w-full text-primary hover:text-primary border-primary/30 hover:border-primary hover:bg-primary/5 transition-all"
                                      >
                                        <Eye className="h-4 w-4 mr-2" />
                                        Deep Dive
                                      </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      </div>

                      {/* Add pagination controls after the Table component */}
                      <div className="mt-4 flex items-center justify-between px-2">
                        <div className="text-sm text-muted-foreground">
                          Showing {startIndex + 1}-{Math.min(endIndex, sortedApps.length)} of {sortedApps.length} applications
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(1);
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(prev => Math.max(1, prev - 1));
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <div className="flex items-center space-x-1">
                            {getPageNumbers().map((page, index) => (
                              page === '...' ? (
                                <span key={`ellipsis-${index}`} className="px-2">...</span>
                              ) : (
                                <Button
                                  key={page}
                                  variant={currentPage === page ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => {
                                    setCurrentPage(Number(page));
                                    mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                  className="w-8"
                                >
                                  {page}
                                </Button>
                              )
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(prev => Math.min(totalPages, prev + 1));
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(totalPages);
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Replace the dashboard view section with the following:
                  // Dashboard view with charts - updated to match the requested charts
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Application Distribution by Category */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                      <h3 className="text-lg font-medium text-gray-900">App Distribution by Category</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        View application distribution across different categories within your organization.
                      </p>
                      <div className="h-80 flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPieChart>
                            <Pie
                              data={getCategoryDistributionData()}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                              nameKey="name"
                              paddingAngle={2}
                              strokeWidth={2}
                              stroke="#fff"
                              onClick={(data) => {
                                checkAuth(() => {
                                // Clear all filters first
                                setFilterRisk(null);
                                setFilterManaged(null);
                                // Set the new category filter
                                setFilterCategory(data.name);
                                setMainView("list");
                                });
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {getCategoryDistributionData().map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.color}
                                  fillOpacity={1}
                                />
                              ))}
                            </Pie>
                            <Legend
                              layout="vertical"
                              align="right"
                              verticalAlign="middle"
                              formatter={(value, entry, index) => {
                                const item = getCategoryDistributionData()[index]
                                return (
                                  <span 
                                    className="text-gray-900 cursor-pointer hover:text-primary"
                                    onClick={() => {
                                      checkAuth(() => {
                                      // Clear all filters first
                                      setFilterRisk(null);
                                      setFilterManaged(null);
                                      // Set the new category filter
                                      setFilterCategory(value);
                                      setMainView("list");
                                      });
                                    }}
                                  >
                                    {value}{" "}
                                    <span className="text-gray-500 ml-4">
                                      {item.percentage}% ({item.value})
                                    </span>
                                  </span>
                                )
                              }}
                            />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    

                    {/* Apps by User Count */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-medium text-gray-900">Top Apps by User Count</h3>
                        <div>
                          <label htmlFor="managed-status-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                          <select
                            id="managed-status-filter"
                            value={chartManagedStatusFilter}
                            onChange={e => setChartManagedStatusFilter(e.target.value)}
                            className="border rounded px-2 py-1 text-sm"
                          >
                            <option value="Any Status">Any Status</option>
                            <option value="Managed">Managed</option>
                            <option value="Unmanaged">Unmanaged</option>
                            <option value="Newly discovered">Newly discovered</option>
                            <option value="Unknown">Unknown</option>
                            <option value="Ignore">Ignore</option>
                            <option value="Not specified">Not specified</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 mb-4">Applications ranked by number of users</p>
                      <div className="h-96 overflow-y-auto">
                        {(() => {
                          const chartData = getAppsByUserCountChartData();
                          if (chartData.length === 0) {
                            return (
                              <div className="h-full flex items-center justify-center text-gray-500">
                                No apps that match this criteria
                              </div>
                            );
                          }
                          return (
                            <ResponsiveContainer width="100%" height={Math.max(350, chartData.length * 30)}>
                              <BarChart data={chartData} layout="vertical" margin={{ left: 150 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={140}
                                  tick={{ fill: '#111827', fontSize: 12 }}
                                  tickFormatter={(value) => truncateText(value, 20)} // Added truncation
                                />
                                <Bar 
                                  dataKey="value" 
                                  name="Users" 
                                  radius={[0, 4, 4, 0]} 
                                  barSize={20}
                                  strokeWidth={1}
                                  stroke="#fff"
                                  cursor="pointer"
                                  onClick={(data) => {
                                    const app = applications.find(a => a.name === data.name);
                                    if (app) {
                                      setMainView("list");
                                      setSelectedAppId(app.id);
                                      setIsUserModalOpen(true);
                                    }
                                  }}
                                >
                                  <LabelList 
                                    dataKey="value" 
                                    position="right" 
                                    fill="#111827"
                                    fontSize={10}
                                    formatter={(value: number) => `${value}`}
                                    offset={4}
                                  />
                                  {chartData.map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.color} 
                                      fillOpacity={1}
                                    />
                                  ))}
                                </Bar>
                                <RechartsTooltip
                                  formatter={(value) => [`${value} users`, ""]}
                                  contentStyle={{ 
                                    backgroundColor: 'white', 
                                    border: '1px solid #e5e7eb', 
                                    borderRadius: '8px', 
                                    padding: '4px 12px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                    fontFamily: 'inherit',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                  }}
                                  labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                  itemStyle={{ color: '#111827', fontWeight: 600 }}
                                  separator=": "
                                  cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>
                    </div>

                  
                      
                        {/* Risk Level Distribution */}
                        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                          <h3 className="text-lg font-medium text-gray-900">Scope Risk Level Distribution</h3>
                          <p className="text-sm text-gray-500 mb-4">Number of applications by scope risk level</p>
                          <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={getRiskChartData()} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={80} 
                                  tick={(props) => {
                                    const { x, y, payload } = props;
                                    return (
                                      <g transform={`translate(${x},${y})`}>
                                        <text
                                          x={-3}
                                          y={0}
                                          dy={4}
                                          textAnchor="end"
                                          fill="#111827"
                                          fontSize={12}
                                          className="cursor-pointer hover:fill-primary transition-colors"
                                          onClick={() => {
                                            // Clear all filters first
                                            setFilterCategory(null);
                                            setFilterManaged(null);
                                            // Set the new risk filter
                                            setFilterRisk(payload.value);
                                            setMainView("list");
                                          }}
                                        >
                                          {truncateText(payload.value, 10)} {/* Apply truncation here */}
                                        </text>
                                      </g>
                                    );
                                  }}
                                />
                                <Bar 
                                  dataKey="value" 
                                  name="Applications" 
                                  radius={[0, 4, 4, 0]} 
                                  barSize={30}
                                  strokeWidth={1}
                                  stroke="#fff"
                                  cursor="pointer"
                                  onClick={(data) => {
                                    // Clear all filters first
                                    setFilterCategory(null);
                                    setFilterManaged(null);
                                    // Set the new risk filter
                                    setFilterRisk(data.name);
                                    setMainView("list");
                                  }}
                                >
                                  {getRiskChartData().map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.color}
                                      fillOpacity={1}
                                    />
                                  ))}
                                </Bar>
                                <RechartsTooltip
                                  formatter={(value) => [`${value} applications`, ""]}
                                  contentStyle={{ 
                                    backgroundColor: 'white', 
                                    border: '1px solid #e5e7eb', 
                                  borderRadius: '8px', 
                                  padding: '4px 12px',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                  fontFamily: 'inherit',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}
                                labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                itemStyle={{ color: '#111827', fontWeight: 600 }}
                                separator=": "
                                cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* High Scope Risk Users chart */}
                      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-medium text-gray-900">High Scope Risk Users</h3>
                          <div>
                            <label htmlFor="high-risk-users-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                            <select
                              id="high-risk-users-filter"
                              value={highRiskUsersManagedStatusFilter}
                              onChange={e => setHighRiskUsersManagedStatusFilter(e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            >
                              <option value="Any Status">Any Status</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Newly discovered">Newly discovered</option>
                              <option value="Unknown">Unknown</option>
                              <option value="Ignore">Ignore</option>
                              <option value="Not specified">Not specified</option>
                            </select>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Applications ranked by number of high-risk users</p>
                        <div className="h-96 overflow-y-auto">
                          {getHighRiskUsersByApp().filter(app => app.value > 0).length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-500">
                              No applications found with high-risk users
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height={Math.max(400, getHighRiskUsersByApp().filter(app => app.value > 0).length * 30)}>
                              <BarChart data={getHighRiskUsersByApp().filter(app => app.value > 0)} layout="vertical" margin={{ left: 150 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={140}
                                  tick={{ fill: '#111827', fontSize: 12 }}
                                  tickFormatter={(value) => truncateText(value, 20)} // Added truncation
                                />
                                <Bar 
                                  dataKey="value" 
                                  name="High-Risk Users" 
                                  radius={[0, 4, 4, 0]} 
                                  barSize={20}
                                  strokeWidth={1}
                                  stroke="#fff"
                                  cursor="pointer"
                                  onClick={(data) => {
                                    const app = applications.find(a => a.name === data.name);
                                    if (app) {
                                      setMainView("list");
                                      setSelectedAppId(app.id);
                                      setIsUserModalOpen(true);
                                    }
                                  }}
                                >
                                  <LabelList 
                                    dataKey="value" 
                                    position="right" 
                                    fill="#111827"
                                    fontSize={10}
                                    formatter={(value: number) => `${value}`}
                                    offset={4}
                                  />
                                  {getHighRiskUsersByApp().filter(app => app.value > 0).map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.color}  
                                      fillOpacity={1}
                                    />
                                  ))}
                                </Bar>
                                <RechartsTooltip
                                  formatter={(value) => [`${value} high-risk ${value === 1 ? 'user' : 'users'}`, ""]}
                                  contentStyle={{ 
                                    backgroundColor: 'white', 
                                    border: '1px solid #e5e7eb', 
                                    borderRadius: '8px', 
                                    padding: '4px 12px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                    fontFamily: 'inherit',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                  }}
                                  labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                  itemStyle={{ color: '#111827', fontWeight: 600 }}
                                  separator=": "
                                  cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>

                      {/* Apps by Scope Permissions */}
                      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-medium text-gray-900">Top Apps by Scope Permissions</h3>
                          <div>
                            <label htmlFor="scope-permissions-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                            <select
                              id="scope-permissions-filter"
                              value={scopePermissionsManagedStatusFilter}
                              onChange={e => setScopePermissionsManagedStatusFilter(e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            >
                              <option value="Any Status">Any Status</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Newly discovered">Newly discovered</option>
                              <option value="Unknown">Unknown</option>
                              <option value="Ignore">Ignore</option>
                              <option value="Not specified">Not specified</option>
                            </select>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Applications ranked by number of scope permissions</p>
                        <div className="h-96 overflow-y-auto">
                          {(() => {
                            const chartData = getTop10AppsByPermissions();
                            if (chartData.length === 0) {
                              return (
                                <div className="h-full flex items-center justify-center text-gray-500">
                                  No apps that match this criteria
                                </div>
                              );
                            }
                            return (
                              <ResponsiveContainer width="100%" height={Math.max(350, chartData.length * 30)}>
                                <BarChart data={chartData} layout="vertical" margin={{ left: 150 }}>
                                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                  <YAxis
                                    dataKey="name"
                                    type="category"
                                    axisLine={false}
                                    tickLine={false}
                                    width={140}
                                    tick={{ fill: '#111827', fontSize: 12 }}
                                    tickFormatter={(value) => truncateText(value, 20)} // Added truncation
                                  />
                                  <Bar 
                                    dataKey="value" 
                                    name="Permissions" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20}
                                    strokeWidth={1}
                                    stroke="#fff"
                                    cursor="pointer"
                                    onClick={(data) => {
                                      const app = applications.find(a => a.name === data.name);
                                      if (app) {
                                        setMainView("list");
                                        setSelectedAppId(app.id);
                                        setIsUserModalOpen(true);
                                      }
                                    }}
                                  >
                                    <LabelList 
                                      dataKey="value" 
                                      position="right" 
                                      fill="#111827"
                                      fontSize={10}
                                      formatter={(value: number) => `${value}`}
                                      offset={4}
                                    />
                                    {chartData.map((entry, index) => (
                                      <Cell 
                                        key={`cell-${index}`} 
                                        fill={entry.color} 
                                        fillOpacity={1}
                                      />
                                    ))}
                                  </Bar>
                                  <RechartsTooltip
                                    formatter={(value) => [`${value} permissions`, ""]}
                                    contentStyle={{ 
                                      backgroundColor: 'white', 
                                      border: '1px solid #e5e7eb', 
                                      borderRadius: '8px', 
                                      padding: '4px 12px',
                                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                      fontFamily: 'inherit',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px'
                                    }}
                                    labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                    itemStyle={{ color: '#111827', fontWeight: 600 }}
                                    separator=": "
                                    cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                  />
                                </BarChart>
                              </ResponsiveContainer>
                            );
                          })()}
                        </div>
                      </div>
                    
                  

                  {/* Application Similarity Groups */}
                  
                    {/* <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 col-span-2">
                      <h3 className="text-lg font-medium text-gray-900">Application Similarity Groups</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Groups of applications that share similar characteristics and usage patterns.
                      </p>
                      <div className="h-[500px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={applications.map(app => ({
                              name: app.name,
                              users: app.userCount,
                              permissions: app.totalPermissions,
                              similar: getSimilarApps(app, applications).length,
                              category: appCategories[app.id] || app.category,
                            }))}
                            layout="vertical"
                            margin={{ left: 150, right: 20, top: 20, bottom: 20 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                            <XAxis type="number" />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={140}
                              tick={({ x, y, payload }) => (
                                <g transform={`translate(${x},${y})`}>
                                  <text
                                    x={-3}
                                    y={0}
                                    dy={4}
                                    textAnchor="end"
                                    fill="#111827"
                                    fontSize={12}
                                    className="cursor-pointer hover:fill-primary transition-colors"
                                    onClick={() => {
                                      const app = applications.find(a => a.name === payload.value);
                                      if (app) {
                                        setMainView("list");
                                        setSelectedAppId(app.id);
                                        setIsUserModalOpen(true);
                                      }
                                    }}
                                  >
                                    {payload.value}
                                  </text>
                                </g>
                              )}
                            />
                            <Bar
                              dataKey="users"
                              stackId="a"
                              name="Users"
                              fill="#4B5563"
                              radius={[0, 4, 4, 0]}
                            >
                              {applications.map((app, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={getCategoryColor(app.category)}
                                  fillOpacity={0.8}
                                  cursor="pointer"
                                  onClick={() => {
                                    setMainView("list");
                                    setSelectedAppId(app.id);
                                    setIsUserModalOpen(true);
                                  }}
                                />
                              ))}
                            </Bar>
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  const app = applications.find(a => a.name === label);
                                  if (!app) return null;

                                  const similarApps = getSimilarApps(app, applications);
                                  return (
                                    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
                                      <p className="font-medium">{label}</p>
                                      <p className="text-sm text-gray-500">{app.category}</p>
                                      <div className="text-sm mt-2">
                                        <div className="font-medium">Similar Apps:</div>
                                        <div className="mt-1 space-y-1">
                                          {similarApps.map(({ app: similarApp, score }, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(similarApp.category) }} />
                                              <span>{similarApp.name}</span>
                                              <span className="text-gray-500">({Math.round(score * 100)}% match)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                              cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                            />
                            <Legend />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div> */}
                  
                </div>
              )}
            </div>
          ) : (
            // User detail view
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-medium text-gray-800">
                    {(() => {
                      // Count how many filters are active
                      const activeFilters = [filterCategory, filterRisk, filterManaged].filter(Boolean).length;
                      
                      if (activeFilters === 0) {
                        return `We found ${sortedApps.length} applications.`;
                      }

                      // Single filter messages
                      if (activeFilters === 1) {
                        if (filterCategory) {
                          return `We found ${sortedApps.length} applications in ${filterCategory}.`;
                        }
                        if (filterRisk) {
                          return `We found ${sortedApps.length} ${filterRisk.toLowerCase()} risk applications.`;
                        }
                        if (filterManaged) {
                          return `We found ${sortedApps.length} ${filterManaged.toLowerCase()} applications.`;
                        }
                      }

                      // Multiple filters - show total count with "filtered"
                      return `We found ${sortedApps.length} filtered applications.`;
                    })()}
                  </h2>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant={mainView === "list" ? "default" : "outline"} 
                    onClick={() => {
                      setMainView("list");
                      setCurrentView("applications");
                      handleCloseUserModal();
                    }}
                    className={mainView === "list" ? "bg-gray-900 hover:bg-gray-800" : ""}
                  >
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Applications
                  </Button>
                  <Button 
                    variant={mainView === "Insights" ? "default" : "outline"} 
                    onClick={() => {
                      setMainView("Insights");
                      setCurrentView("ai-risk-analysis");
                      handleCloseUserModal();
                    }}
                    className={mainView === "Insights" ? "bg-gray-900 hover:bg-gray-800" : ""}
                  >
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Insights
                  </Button>

                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="p-6">
                {selectedApp && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCloseUserModal}
                          className="flex items-center gap-1 text-gray-700 hover:bg-gray-100"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          <span>Back</span>
                        </Button>
                        <div>
                          <h2 className="text-xl font-bold">{selectedApp.name}</h2>
                          <p className="text-sm text-muted-foreground">{selectedApp.userCount} users with access</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        
                          <div className="flex items-center gap-1">
                            <span className="text-sm text-muted-foreground font-medium">Risk:</span>
                            <RiskBadge level={selectedApp.riskLevel} />
                          </div>
                    
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground font-medium">Managed Status:</span>
                          <select
                              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                            value={editedStatuses[selectedApp.id] || selectedApp.managementStatus}
                            onChange={(e) => handleStatusChange(selectedApp.id, e.target.value)}
                          >
                            <option value="Managed">Managed</option>
                            <option value="Unmanaged">Unmanaged</option>
                            <option value="Newly discovered">Newly discovered</option>
                            <option value="Unknown">Unknown</option>
                            <option value="Ignore">Ignore</option>
                            <option value="Not specified">Not specified</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* App Details Card */}
                    <div className="mb-6 p-5 rounded-lg bg-gray-50 border border-gray-200">
                      <h3 className="text-sm font-semibold mb-2">Application Details</h3>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <dt className="text-muted-foreground font-medium">Category</dt>
                          <dd className="font-medium">{selectedApp.category}</dd>
                        </div>
                        
                          <div>
                            <dt className="text-muted-foreground font-medium">Total Scope Permissions</dt>
                            <dd className="font-medium">{selectedApp.totalPermissions}</dd>
                          </div>
                      
                        <div>
                          <dt className="text-muted-foreground font-medium">Owner</dt>
                          <dd className="font-medium">{selectedApp.ownerEmail || "Not assigned"}</dd>
                        </div>
                      </dl>
                    </div>

                    <Tabs defaultValue={defaultTab} className="mb-6">
                      <TabsList className="bg-gray-100 p-1">
                        <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                        All Users
                        </TabsTrigger>
                        <TabsTrigger value="scopes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                        Scope User Groups
                        </TabsTrigger>
                        <TabsTrigger value="ai-risk-scoring" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                        AI Risk Scoring
                        </TabsTrigger>
                        {/* <TabsTrigger value="similar" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                          Similar Apps
                        </TabsTrigger> */}
                        <TabsTrigger value="notes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                          Notes
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="users">
                        <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
                          <div className="flex-1">
                            <Label htmlFor="userSearch" className="text-sm font-medium">
                              Search Users
                            </Label>
                            <Input
                              id="userSearch"
                              placeholder="Search by name or email..."
                              value={userSearchTerm}
                              onChange={(e) => setUserSearchTerm(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        </div>

                        <div className="rounded-md border">
                            <div className="max-h-[800px] overflow-y-auto">
                          <Table>
                                <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                              <TableRow>
                                    <TableHead className="w-[50px] rounded-tl-lg bg-transparent">#</TableHead>
                                    <TableHead 
                                      className="w-[200px] cursor-pointer bg-transparent" 
                                      onClick={() => handleUserSort("name")}
                                    >
                                      <div className="flex items-center">
                                        User
                                        {getUserSortIcon("name")}
                                      </div>
                                    </TableHead>
                                    <TableHead 
                                      className="cursor-pointer bg-transparent"
                                      onClick={() => handleUserSort("email")}
                                    >
                                      <div className="flex items-center">
                                        Email
                                        {getUserSortIcon("email")}
                                      </div>
                                    </TableHead>

                                    <TableHead 
                                      className="cursor-pointer rounded-tr-lg bg-transparent"
                                      onClick={() => handleUserSort("riskLevel")}
                                    >
                                      <div className="flex items-center">
                                      User Scope Risk
                                        {getUserSortIcon("riskLevel")}
                                      </div>
                                    </TableHead>
                                  
                                    <TableHead className="bg-transparent">Scope Permissions</TableHead>
                                    
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                                  {currentUsers.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                                    No users found matching your search
                                  </TableCell>
                                </TableRow>
                              ) : (
                                    currentUsers.map((user, index) => (
                                  <TableRow key={user.id} className={index % 2 === 0 ? "bg-muted/30" : ""}>
                                        <TableCell className="text-muted-foreground">{userStartIndex + index + 1}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <Avatar className="h-8 w-8">
                                          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                                            {getInitials(user.name)}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="font-medium">{user.name}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                      <TooltipProvider>
                                        <Tooltip delayDuration={300}>
                                          <TooltipTrigger asChild>
                                            <div className="flex items-center ml-4">
                                              <RiskBadge level={user.riskLevel} scopes={user.scopes} />
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="p-2">
                                            <p className="text-xs">{user.riskReason}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </TableCell>
                                    <TableCell>
                                      <div className="max-h-24 overflow-y-auto text-sm">
                                        {user.scopes.map((scope, i) => {
                                          // Use the centralized risk assessment function
                                          const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                          
                                          // Use the centralized color function
                                          const riskColor = getRiskLevelColor(scopeRiskLevel);
                                          const riskStatus = `${transformRiskLevel(scopeRiskLevel)}-Risk Scope`;
                                          
                                          return (
                                            <div key={i} className="py-1 border-b border-muted last:border-0 flex items-center">
                                              <TooltipProvider>
                                                <Tooltip delayDuration={300}>
                                                  <TooltipTrigger asChild>
                                                    <div 
                                                      className="w-2 h-2 rounded-full mr-2 flex-shrink-0 cursor-pointer" 
                                                      style={{ backgroundColor: riskColor }}
                                                    />
                                                  </TooltipTrigger>
                                                  <TooltipContent side="left" className="p-2">
                                                    <p className="text-xs font-medium">{riskStatus}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                              <span className="truncate">{scope}</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                            </div>

                            {/* User pagination controls */}
                            <div className="mt-4 flex items-center justify-between px-4 py-2 border-t border-gray-200">
                              <div className="text-sm text-muted-foreground">
                                Showing {userStartIndex + 1}-{Math.min(userEndIndex, filteredUsers.length)} of {filteredUsers.length} users
                              </div>
                              <div className="flex items-center space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(1)}
                                  disabled={userCurrentPage === 1}
                                >
                                  First
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(prev => Math.max(1, prev - 1))}
                                  disabled={userCurrentPage === 1}
                                >
                                  Previous
                                </Button>
                                <div className="flex items-center space-x-1">
                                  {getUserPageNumbers().map((page, index) => (
                                    page === '...' ? (
                                      <span key={`ellipsis-${index}`} className="px-2">...</span>
                                    ) : (
                                      <Button
                                        key={page}
                                        variant={userCurrentPage === page ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setUserCurrentPage(Number(page))}
                                        className="w-8"
                                      >
                                        {page}
                                      </Button>
                                    )
                                  ))}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(prev => Math.min(totalUserPages, prev + 1))}
                                  disabled={userCurrentPage === totalUserPages}
                                >
                                  Next
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(totalUserPages)}
                                  disabled={userCurrentPage === totalUserPages}
                                >
                                  Last
                                </Button>
                              </div>
                            </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="scopes">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <h3 className="text-lg font-medium mb-4">Scope User Groups</h3>
                          <p className="text-sm text-black mb-4">
                            Users are grouped by identical scope permission sets. Each user group represents a unique set of permissions.
                          </p>

                            {(() => {
                              const scopeGroups = getScopeGroups(selectedApp)
                              const totalScopePages = Math.ceil(scopeGroups.length / itemsPerPage)
                              const scopeStartIndex = (scopeCurrentPage - 1) * itemsPerPage
                              const scopeEndIndex = scopeStartIndex + itemsPerPage
                              const currentScopeGroups = scopeGroups.slice(scopeStartIndex, scopeEndIndex)

                              return (
                                <>
                                  {/* First box - All Application Scopes */}
                                  <div className="mb-6 border rounded-md overflow-hidden">
                                    <div className="p-3 flex justify-between items-center border-b border-gray-200 bg-blue-50">
                                      <h4 className="font-medium">
                                        <span className="flex items-center">
                                          <Info className="h-4 w-4 mr-1 text-blue-600" />
                                          All Application Scopes
                                        </span>
                                      </h4>
                                      <Badge variant="default" className="bg-blue-600">
                                        {selectedApp?.scopes.length || 0} {(selectedApp?.scopes.length || 0) === 1 ? "permission" : "permissions"}
                                      </Badge>
                                    </div>

                                    <div className="p-3 border-b">
                                      <div className="max-h-60 overflow-y-auto">
                                        {selectedApp?.scopes.map((scope, scopeIndex) => {
                                          // Use the centralized risk assessment function
                                          const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                          
                                          // Use the centralized color function
                                          const riskColor = getRiskLevelColor(scopeRiskLevel);

                                          return (
                                            <div key={scopeIndex} className="py-1 border-b border-muted last:border-0 flex items-center">
                                              <div 
                                                className="w-2 h-2 rounded-full mr-2 flex-shrink-0" 
                                                style={{ backgroundColor: riskColor }}
                                              />
                                              <span className="text-sm">{scope}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <div className="p-3">
                                      <p className="text-sm text-muted-foreground">
                                        This represents all permissions the application could request from any user
                                      </p>
                                    </div>
                                  </div>

                                  {/* User Group boxes - skip the first "All Scopes" group */}
                                  {currentScopeGroups
                                    .filter(group => !group.isAllScopes)
                                    .map((group, groupIndex: number) => {
                                      // Determine highest risk level in this group
                                      const hasHighRisk = group.scopes.some((scope: string) => evaluateSingleScopeRisk(scope) === 'High');
                                      const hasMediumRisk = !hasHighRisk && group.scopes.some((scope: string) => evaluateSingleScopeRisk(scope) === 'Medium');

                                      return (
                                        <div key={groupIndex} className="mb-6 border rounded-md overflow-hidden">
                                          <div className="p-3 flex justify-between items-center border-b border-gray-200 bg-gray-50">
                                            <h4 className="font-medium">
                                              User Group {scopeStartIndex + groupIndex + 1} - {group.users.length} {group.users.length === 1 ? "user" : "users"}
                                            </h4>
                                            <div className="flex items-center gap-2">
                                              {hasHighRisk && (
                                                <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                                  Contains high-risk scopes
                                                </Badge>
                                              )}
                                              {hasMediumRisk && (
                                                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                                                  Contains medium-risk scopes
                                                </Badge>
                                              )}
                                              <Badge variant="outline" className="bg-primary/10">
                                                {group.scopes.length} {group.scopes.length === 1 ? "permission" : "permissions"}
                                              </Badge>
                                            </div>
                                          </div>

                                          <div className="p-3 border-b">
                                            <h5 className="text-sm font-medium mb-2">Permissions:</h5>
                                            <div className="max-h-60 overflow-y-auto">
                                              {group.scopes.map((scope: string, scopeIndex: number) => {
                                                // Use the centralized risk assessment function
                                                const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                                
                                                // Use the centralized color function
                                                const riskColor = getRiskLevelColor(scopeRiskLevel);

                                                return (
                                                  <div key={scopeIndex} className="py-1 border-b border-muted last:border-0 flex items-center">
                                                    <div 
                                                      className="w-2 h-2 rounded-full mr-2 flex-shrink-0" 
                                                      style={{ backgroundColor: riskColor }}
                                                    />
                                                    <span className="text-sm">{scope}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>

                                          <div className="p-3">
                                            <h5 className="text-sm font-medium mb-2">
                                              Users with this permission set:
                                            </h5>
                                            <div className="flex flex-wrap gap-2">
                                              {group.users.map((user: AppUser, userIndex: number) => (
                                                <div
                                                  key={userIndex}
                                                  className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200"
                                                >
                                                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-200 text-xs font-medium text-gray-800">
                                                    {getInitials(user.name)}
                                                  </div>
                                                  <span className="text-sm">{user.name}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}

                                  {/* Scope Groups pagination controls */}
                                  {scopeGroups.length > itemsPerPage && (
                                    <div className="mt-4 flex items-center justify-between px-4 py-2 border-t border-gray-200">
                                      <div className="text-sm text-muted-foreground">
                                        Showing {scopeStartIndex + 1}-{Math.min(scopeEndIndex, scopeGroups.length)} of {scopeGroups.length} scope groups
                                      </div>
                                      <div className="flex items-center space-x-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(1)}
                                          disabled={scopeCurrentPage === 1}
                                        >
                                          First
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(prev => Math.max(1, prev - 1))}
                                          disabled={scopeCurrentPage === 1}
                                        >
                                          Previous
                                        </Button>
                                        <div className="flex items-center space-x-1">
                                          {getScopePageNumbers(totalScopePages).map((page, index) => (
                                            page === '...' ? (
                                              <span key={`ellipsis-${index}`} className="px-2">...</span>
                                            ) : (
                                              <Button
                                                key={page}
                                                variant={scopeCurrentPage === page ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setScopeCurrentPage(Number(page))}
                                                className="w-8"
                                              >
                                                {page}
                                              </Button>
                                            )
                                          ))}
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(prev => Math.min(totalScopePages, prev + 1))}
                                          disabled={scopeCurrentPage === totalScopePages}
                                        >
                                          Next
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(totalScopePages)}
                                          disabled={scopeCurrentPage === totalScopePages}
                                        >
                                          Last
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                      </TabsContent>

                      {/* <TabsContent value="similar">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <h3 className="text-lg font-medium mb-4">Similar Applications</h3>
                          <p className="text-sm text-muted-foreground mb-6">
                            Apps that share similar usage patterns with {selectedApp.name}, based on user behavior and functional overlap.
                          </p>

                          <div className="space-y-6">
                            {getSimilarApps(selectedApp, applications).map(({ app, score, reasons }) => (
                              <div key={app.id} className="p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                      <AppIcon name={app.name} logoUrl={app.logoUrl} logoUrlFallback={app.logoUrlFallback} />
                                      <div>
                                        <h4 className="font-medium">{app.name}</h4>
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm text-muted-foreground">{app.category}</span>
                                          <span className="text-sm text-muted-foreground">•</span>
                                          <span className="text-sm font-medium text-primary">{Math.round(score * 100)}% match</span>
                                        </div>
                                      </div>
                                    </div>

                                   
                                    <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded-md">
                                      <div>
                                        <div className="text-sm text-muted-foreground">Shared Users</div>
                                        <div className="text-lg font-medium">
                                          {app.users.filter(u => 
                                            selectedApp.users.some(su => su.email === u.email)
                                          ).length}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-sm text-muted-foreground">Common Functions</div>
                                        <div className="text-lg font-medium">
                                          {Array.from(getAppFunctionality(app.scopes)).filter(f => 
                                            getAppFunctionality(selectedApp.scopes).has(f)
                                          ).length}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-sm text-muted-foreground">Active Users</div>
                                        <div className="text-lg font-medium">
                                          {app.users.length}
                                        </div>
                                      </div>
                                    </div>

                                    
                                    <div className="space-y-2">
                                      {reasons.map((reason, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                          <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                                          <span className="text-sm">{reason}</span>
                            </div>
                          ))}
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-3">
                                    <RiskBadge level={app.riskLevel} />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedAppId(app.id);
                                        setIsUserModalOpen(true);
                                      }}
                                      className="whitespace-nowrap"
                                    >
                                      <Eye className="h-4 w-4 mr-2" />
                                      View Details
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TabsContent> */}

                      <TabsContent value="ai-risk-scoring">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <TabbedRiskScoringView 
                            app={(() => {
                              // Fast lookup using pre-computed map instead of array search
                              if (!selectedApp) return null;
                              
                              const cleanAppName = selectedApp.name.trim().toLowerCase();
                              const result = aiDataMap.get(cleanAppName) || null;
                              
                              console.log('DEBUG - Fast lookup result for', cleanAppName, ':', result);
                              return result;
                            })()}
                            allApps={aiRiskData}
                            orgSettings={orgSettings}
                            selectedAppData={selectedApp}
                          />
                        </div>
                      </TabsContent>

                      <TabsContent value="notes">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="owner" className="text-sm font-medium">
                                Owner Email
                              </Label>
                              <Input
                                id="owner"
                                placeholder="Enter owner email"
                                value={ownerEmail}
                                onChange={(e) => setOwnerEmail(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor="notes" className="text-sm font-medium">
                                Notes
                              </Label>
                              <textarea
                                id="notes"
                                className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background mt-1"
                                placeholder="Add notes about this application..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                              />
                            </div>
                            
                            {saveMessage && (
                              <div className={`p-3 rounded-md ${
                                saveMessage.type === "success" 
                                  ? "bg-green-50 text-green-700 border border-green-200" 
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}>
                                {saveMessage.text}
                              </div>
                            )}
                            
                            <Button 
                              onClick={handleSaveNotesAndOwner} 
                              disabled={isSaving}
                            >
                              {isSaving ? "Saving..." : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </>
                )}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </main>
    

      {/* Update the custom styles */}
      <style jsx global>{`
        .last-row td:first-child {
          border-bottom-left-radius: 0.75rem;
        }
        .last-row td:last-child {
          border-bottom-right-radius: 0.75rem;
        }
        
        /* Custom scrollbar styles */
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 3px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }

        /* Table styles */
        table {
          border-collapse: separate;
          border-spacing: 0;
        }

        th {
          font-weight: 500;
          color: #4b5563;
          background: transparent;
        }

        td {
          color: #374151;
        }

        tr:hover {
          background-color: rgba(0, 0, 0, 0.02);
        }

        /* Dropdown styles */
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
          background-position: right 0.5rem center;
          background-repeat: no-repeat;
          background-size: 1.5em 1.5em;
          padding-right: 2.5rem;
          min-width: 140px;
        }

        select:hover {
          border-color: #d1d5db;
        }

        select:focus {
          border-color: #9ca3af;
          box-shadow: 0 0 0 2px rgba(156, 163, 175, 0.2);
          outline: none;
        }

        select option {
          padding: 8px;
          background-color: white;
          color: #374151;
        }

        /* Button hover states */
        button:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }

        button[data-state="active"] {
          background-color: #111827;
          color: white;
        }

        button[data-state="active"]:hover {
          background-color: #1f2937;
        }
      `}</style>
    </div>
  )
}

