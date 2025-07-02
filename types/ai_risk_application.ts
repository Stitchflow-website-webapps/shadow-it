export interface Application {
  id: string;
  name: string;
  category: string | null;
  lastUsed: string;
  userCount: number;
  riskScore: number;
  riskLevel?: string;
}

// New interfaces for detailed application data from CSV
export interface AITechnologyData {
  "Key AI Features": string;
  "Proprietary Model or 3rd Party?": string;
  "AI Model Hosting Location / Data Residency": string;
  "Data Sent to AI Model?": string;
  "Type of Data Sent": string;
  "Customer/Org Data Used for Model Training?": string;
  "User Opt-Out of AI?": string;
}

export interface SecurityComplianceData {
  "Data Retention Policy": string;
  "Data Backup/Retrieval/Deletion Details": string;
  "Human Review Involvement": string;
  "Security Certifications": string;
  "AI Specific Security Standards": string;
  "Vulnerability Disclosure": string;
  "Recently Known Breaches/ Incidents / Public Issues": string;
  "Supports SSO/SAML/SCIM": string;
  "Authentication Methods": string;
  "APIs Available?": string;
  "Supports RBAC (or some form of user permissions and roles)?": string;
  "Bug Bounty System Available?": string;
  "Trust Contact Info (email ID if available)": string;
  "Other AI-Specific Terms / Disclosures": string;
}

export interface BusinessImpactData {
  "Org Level Criticality (company wide/ specific usage)": string;
  "Departments/Teams Suitable for App Usage": string;
  "Impact to Business (when app data/functionality is compromised)": string;
  "App Performance/Popularity Sentiment": string;
  "Ease of App Setup": string;
  "Need Employee Training Before Usage?": string;
  "Overall Security Risk Factor & Tier": string;
  "Renewals & Upgrade Terms": string;
  "Notes / Observations": string;
}

export interface PerformanceAdoptionData {
  "Global Adoption Rank": string;
  "No. of Active Customers (Reported)": string;
  "Popularity percentage": string;
  "Benchmark Usage by Peers": string;
  "Stack Inclusion Rate": string;
  "Best paired with": string;
  "Other popular apps in this space": string;
}

export interface DetailedApplicationData extends Application {
  "Tool Name": string;
  aiTechnology: AITechnologyData;
  securityCompliance: SecurityComplianceData;
  businessImpact: BusinessImpactData;
  performanceAdoption: PerformanceAdoptionData;
} 