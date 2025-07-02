import Papa from "papaparse"
import { Application, AppUser } from "@/types"
import { determineRiskLevel } from "@/lib/risk-assessment"
import { DetailedApplicationData, AITechnologyData, SecurityComplianceData, BusinessImpactData, PerformanceAdoptionData } from "@/types/ai_risk_application"

export const fetchData = async (): Promise<Application[]> => {
  try {
    console.log("Starting data fetch...")
    const appsPromise = fetch("/applications.csv").then(res => res.text())
    const usersPromise = fetch("/users.csv").then(res => res.text())
    const userAppsPromise = fetch("/applications_data.csv").then(res => res.text())
    const aiScoringPromise = fetch("/Adam_revised_latest_app.csv").then(res => res.text())

    const [appsCsv, usersCsv, userAppsCsv, aiScoringCsv] = await Promise.all([appsPromise, usersPromise, userAppsPromise, aiScoringPromise])
    console.log("CSV files loaded - apps length:", appsCsv.length, "users length:", usersCsv.length, "userApps length:", userAppsCsv.length, "aiScoring length:", aiScoringCsv.length)

    const appsResult = Papa.parse(appsCsv, { header: true, skipEmptyLines: true })
    const usersResult = Papa.parse(usersCsv, { header: true, skipEmptyLines: true })
    const userAppsResult = Papa.parse(userAppsCsv, { header: true, skipEmptyLines: true })
    const aiScoringResult = Papa.parse(aiScoringCsv, { header: true, skipEmptyLines: true })

    const applicationsData: any[] = appsResult.data
    const usersData: any[] = usersResult.data
    const userAppsData: any[] = userAppsResult.data
    const aiScoringData: any[] = aiScoringResult.data

    console.log("Parsed data - apps:", applicationsData.length, "users:", usersData.length, "userApps:", userAppsData.length, "aiScoring:", aiScoringData.length)
    console.log("Sample app:", applicationsData[0])
    console.log("Sample user:", usersData[0])
    console.log("Sample userApp:", userAppsData[0])
    console.log("Sample aiScoring:", aiScoringData[0])

    const getAppUsers = (appId: string): AppUser[] => {
      return userAppsData
        .filter((ua: any) => ua.application_id === appId)
        .map((ua: any) => {
          const user = usersData.find((u: any) => u.id === ua.user_id)
          let scopes: string[] = []
          if (typeof ua.scopes === "string") {
            try {
              scopes = JSON.parse(ua.scopes)
            } catch (e) {
              scopes = (ua.scopes || "")
                .replace(/^{|}$/g, "")
                .split`,`
                .map((s: string) => s.trim().replace(/^"|"$/g, ""))
            }
          }

          return {
            id: ua.user_id,
            appId: ua.application_id,
            name: user ? user.name : "Unknown User",
            email: user ? user.email : "unknown@acme.com",
            lastActive: ua.last_used,
            created_at: ua.created_at,
            scopes: scopes,
            riskLevel: determineRiskLevel(scopes),
            riskReason: "No reason specified", // Placeholder
          }
        })
    }

    const processedApplications: Application[] = applicationsData.map(
      (app: any): Application => {
        const appUsers = getAppUsers(app.id)
        const allScopes = appUsers.flatMap(u => u.scopes)
        const uniqueScopes = [...new Set(allScopes)]

        // Find matching AI scoring data by app name
        const aiData = aiScoringData.find((ai: any) => 
          ai["Tool Name"]?.toLowerCase().trim() === app.name?.toLowerCase().trim()
        )

        return {
          id: app.id,
          name: app.name,
          category: app.category || "Uncategorized",
          userCount: appUsers.length,
          users: appUsers,
          riskLevel: determineRiskLevel(uniqueScopes),
          riskReason: "No reason specified", // Placeholder
          totalPermissions: uniqueScopes.length,
          scopeVariance: { userGroups: 0, scopeGroups: 0 }, // Placeholder
          logoUrl: app.image_url,
          managementStatus: "Unmanaged", // Placeholder
          ownerEmail: "owner@acme.com", // Placeholder
          notes: "", // Placeholder
          scopes: uniqueScopes,
          isInstalled: true, // Placeholder
          isAuthAnonymously: false, // Placeholder
          aiScoringData: aiData || null, // Add AI scoring data
        }
      },
    )

    return processedApplications
  } catch (error) {
    console.error("Failed to fetch or parse data:", error)
    return []
  }
}

// Export the AI scoring data separately for organization settings
export const fetchAIScoringData = async (): Promise<any[]> => {
  try {
    const response = await fetch("/Adam_revised_latest_app.csv")
    const csvText = await response.text()
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
    return result.data as any[]
  } catch (error) {
    console.error("Failed to fetch AI scoring data:", error)
    return []
  }
}

// Parse CSV with detailed data for AI Risk tabs
export const fetchDetailedAppData = async (): Promise<DetailedApplicationData[]> => {
  try {
    // Fetch the detailed data from the API instead of CSV files
    const response = await fetch("/api/ai-risk-data");
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error('Failed to fetch data from API');
    }
    
    // Transform the database data into the expected format
    const transformedData: DetailedApplicationData[] = result.data.map((rawData: any) => 
      transformToDetailedAppData(rawData)
    );
    
    return transformedData;
  } catch (error) {
    console.error("Error fetching detailed data:", error);
    return [];
  }
};

const transformToDetailedAppData = (rawData: any): DetailedApplicationData => {
  // Helper function to safely get field value with trimming
  const getField = (fieldName: string): string => {
    const value = rawData[fieldName];
    return (value && typeof value === 'string') ? value.trim() : "";
  };

  // Create base application data - preserve original field names for matching
  const baseApp = {
    id: rawData.app_id?.toString() || "",
    name: getField("Tool Name"),
    category: getField("Vendor") || "Uncategorized",
    lastUsed: "",
    userCount: 0,
    riskScore: 0,
    riskLevel: "Medium" as const,
    // Preserve the original "Tool Name" field for matching logic
    "Tool Name": getField("Tool Name")
  };

  // Structure detailed data into categories
  const aiTechnology: AITechnologyData = {
    "Key AI Features": getField("Key AI Features"),
    "Proprietary Model or 3rd Party?": getField("Proprietary Model or 3rd Party?"),
    "AI Model Hosting Location / Data Residency": getField("AI Model Hosting Location / Data Residency"),
    "Data Sent to AI Model?": getField("Data Sent to AI Model?"),
    "Type of Data Sent": getField("Type of Data Sent"),
    "Customer/Org Data Used for Model Training?": getField("Customer/Org Data Used for Model Training?"),
    "User Opt-Out of AI?": getField("User Opt-Out of AI?"),
  };

  const securityCompliance: SecurityComplianceData = {
    "Data Retention Policy": getField("Data Retention Policy"),
    "Data Backup/Retrieval/Deletion Details": getField("Data Backup/Retrieval/Deletion Details"),
    "Human Review Involvement": getField("Human Review Involvement"),
    "Security Certifications": getField("Security Certifications"),
    "AI Specific Security Standards": getField("AI Specific Security Standards"),
    "Vulnerability Disclosure": getField("Vulnerability Disclosure"),
    "Recently Known Breaches/ Incidents / Public Issues": getField("Recently Known Breaches/ Incidents / Public Issues"),
    "Supports SSO/SAML/SCIM": getField("Supports SSO/SAML/SCIM"),
    "Authentication Methods": getField("Authentication Methods"),
    "APIs Available?": getField("APIs Available?"),
    "Supports RBAC (or some form of user permissions and roles)?": getField("Supports RBAC (or some form of user permissions and roles)?"),
    "Bug Bounty System Available?": getField("Bug Bounty System Available?"),
    "Trust Contact Info (email ID if available)": getField("Trust Contact Info (email ID if available)"),
    "Other AI-Specific Terms / Disclosures": getField("Other AI-Specific Terms / Disclosures"),
  };

  const businessImpact: BusinessImpactData = {
    "Org Level Criticality (company wide/ specific usage)": getField("Org Level Criticality (company wide/ specific usage)"),
    "Departments/Teams Suitable for App Usage": getField("Departments/Teams Suitable for App Usage"),
    "Impact to Business (when app data/functionality is compromised)": getField("Impact to Business (when app data/functionality is compromised)"),
    "App Performance/Popularity Sentiment": getField("App Performance/Popularity Sentiment"),
    "Ease of App Setup": getField("Ease of App Setup"),
    "Need Employee Training Before Usage?": getField("Need Employee Training Before Usage?"),
    "Overall Security Risk Factor & Tier": getField("Overall Security Risk Factor & Tier"),
    "Renewals & Upgrade Terms": getField("Renewals & Upgrade Terms"),
    "Notes / Observations": getField("Notes / Observations"),
  };

  const performanceAdoption: PerformanceAdoptionData = {
    "Global Adoption Rank": getField("Global Adoption Rank"),
    "No. of Active Customers (Reported)": getField("No. of Active Customers (Reported)"),
    "Popularity percentage": getField("Popularity percentage"),
    "Benchmark Usage by Peers": getField("Benchmark Usage by Peers"),
    "Stack Inclusion Rate": getField("Stack Inclusion Rate"),
    "Best paired with": getField("Best paired with"),
    "Other popular apps in this space": getField("Other popular apps in this space"),
  };

  console.log("Transforming data for:", baseApp["Tool Name"], "- Raw data keys:", Object.keys(rawData));

  return {
    ...baseApp,
    aiTechnology,
    securityCompliance,
    businessImpact,
    performanceAdoption,
  };
}; 