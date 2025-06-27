import Papa from "papaparse"
import { Application, AppUser } from "@/types"
import { determineRiskLevel } from "@/lib/risk-assessment"
import { DetailedApplicationData, AITechnologyData, SecurityComplianceData, BusinessImpactData, PerformanceAdoptionData } from "@/types/application"

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
    // Fetch the detailed CSV file from public folder
    const response = await fetch("/Adam_revised_latest_app.csv");
    const csvText = await response.text();
    
    // Parse CSV into structured data
    const parsedData = parseDetailedCSV(csvText);
    return parsedData;
  } catch (error) {
    console.error("Error fetching detailed data:", error);
    return [];
  }
};

const parseDetailedCSV = (csvText: string): DetailedApplicationData[] => {
  const lines = csvText.split("\n");
  const headers = lines[0].split(",").map(header => header.replace(/"/g, "").trim());
  
  return lines
    .slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = parseCSVLine(line);
      const rawApp: any = {};
      headers.forEach((header, index) => {
        rawApp[header] = values[index] || "";
      });
      
      // Transform raw data into structured format
      return transformToDetailedAppData(rawApp);
    });
};

// Handle CSV parsing with quoted values
const parseCSVLine = (line: string): string[] => {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
};

const transformToDetailedAppData = (rawData: any): DetailedApplicationData => {
  // Create base application data
  const baseApp = {
    "Tool Name": rawData["Tool Name"] || "",
    "Vendor": rawData["Vendor"] || "",
    "What the app does": rawData["What the app does"] || "",
    "URL / Website": rawData["URL / Website"] || "",
    "Pricing": rawData["Pricing"] || "",
    "Gen AI-Native": rawData["Gen AI-Native"] || "",
    // Add other existing fields as needed
    ...rawData
  };

  // Structure detailed data into categories
  const aiTechnology: AITechnologyData = {
    "Key AI Features": rawData["Key AI Features"] || "",
    "Proprietary Model or 3rd Party?": rawData["Proprietary Model or 3rd Party?"] || "",
    "AI Model Hosting Location / Data Residency": rawData["AI Model Hosting Location / Data Residency"] || "",
    "Data Sent to AI Model?": rawData["Data Sent to AI Model?\t"] || rawData["Data Sent to AI Model?"] || "",
    "Type of Data Sent": rawData["Type of Data Sent\t\t"] || rawData["Type of Data Sent"] || "",
    "Customer/Org Data Used for Model Training?": rawData["Customer/Org Data Used for Model Training?"] || "",
    "User Opt-Out of AI?": rawData["User Opt-Out of AI?"] || "",
  };

  const securityCompliance: SecurityComplianceData = {
    "Data Retention Policy": rawData["Data Retention Policy"] || "",
    "Data Backup/Retrieval/Deletion Details": rawData["Data Backup/Retrieval/Deletion Details "] || rawData["Data Backup/Retrieval/Deletion Details"] || "",
    "Human Review Involvement": rawData["Human Review Involvement"] || "",
    "Security Certifications": rawData["Security Certifications"] || "",
    "AI Specific Security Standards": rawData["AI Specific Security Standards"] || "",
    "Vulnerability Disclosure": rawData["Vulnerability Disclosure"] || "",
    "Recently Known Breaches/ Incidents / Public Issues": rawData["Recently Known Breaches/ Incidents / Public Issues"] || "",
    "Supports SSO/SAML/SCIM": rawData["Supports SSO/SAML/SCIM"] || "",
    "Authentication Methods": rawData["Authentication Methods "] || rawData["Authentication Methods"] || "",
    "APIs Available?": rawData["APIs Available?"] || "",
    "Supports RBAC (or some form of user permissions and roles)?": rawData["Supports RBAC (or some form of user permissions and roles)?"] || "",
    "Bug Bounty System Available?": rawData["Bug Bounty System Available?"] || "",
    "Trust Contact Info (email ID if available)": rawData["Trust Contact Info (email ID if available)"] || "",
    "Other AI-Specific Terms / Disclosures": rawData["Other AI-Specific Terms / Disclosures"] || "",
  };

  const businessImpact: BusinessImpactData = {
    "Org Level Criticality (company wide/ specific usage)": rawData["Org Level Criticality (company wide/ specific usage)"] || "",
    "Departments/Teams Suitable for App Usage": rawData["Departments/Teams Suitable for App Usage "] || rawData["Departments/Teams Suitable for App Usage"] || "",
    "Impact to Business (when app data/functionality is compromised)": rawData["Impact to Business (when app data/functionality is compromised)"] || "",
    "App Performance/Popularity Sentiment": rawData["App Performance/Popularity Sentiment"] || "",
    "Ease of App Setup": rawData["Ease of App Setup"] || "",
    "Need Employee Training Before Usage?": rawData["Need Employee Training Before Usage?\t"] || rawData["Need Employee Training Before Usage?"] || "",
    "Overall Security Risk Factor & Tier": rawData["Overall Security Risk Factor & Tier"] || "",
    "Renewals & Upgrade Terms": rawData["Renewals & Upgrade Terms"] || "",
    "Notes / Observations": rawData["Notes / Observations"] || "",
  };

  const performanceAdoption: PerformanceAdoptionData = {
    "Global Adoption Rank": rawData["Global Adoption Rank"] || "",
    "No. of Active Customers (Reported)": rawData["No. of Active Customers (Reported)"] || "",
    "Popularity percentage": rawData["Popularity percentage"] || "",
    "Benchmark Usage by Peers": rawData["Benchmark Usage by Peers"] || "",
    "Stack Inclusion Rate": rawData["Stack Inclusion Rate"] || "",
    "Best paired with": rawData["Best paired with"] || "",
    "Other popular apps in this space": rawData["Other popular apps in this space"] || "",
  };

  return {
    ...baseApp,
    aiTechnology,
    securityCompliance,
    businessImpact,
    performanceAdoption,
  };
}; 