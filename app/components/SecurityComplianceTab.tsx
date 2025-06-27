import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SecurityComplianceData } from "@/types/application";

interface SecurityComplianceTabProps {
  data: SecurityComplianceData;
}

export const SecurityComplianceTab: React.FC<SecurityComplianceTabProps> = ({ data }) => {
  const renderField = (label: string, value: string) => {
    const displayValue = value || "Not specified";
    const isEmpty = !value || value.trim() === "";
    
    return (
      <div className="flex flex-col space-y-1 py-3 border-b border-gray-100 last:border-b-0">
        <div className="font-medium text-sm text-gray-700">{label}:</div>
        <div className={`text-sm leading-relaxed ${isEmpty ? 'text-gray-400 italic' : 'text-gray-900'}`}>
          {displayValue}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Security & Compliance</h3>
        <p className="text-sm text-gray-500 mb-6">Comprehensive security measures and compliance information</p>
      </div>
      
      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Data Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Data Retention Policy", data["Data Retention Policy"])}
          {renderField("Data Backup/Retrieval/Deletion Details", data["Data Backup/Retrieval/Deletion Details"])}
          {renderField("Human Review Involvement", data["Human Review Involvement"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Security Certifications & Standards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Security Certifications", data["Security Certifications"])}
          {renderField("AI Specific Security Standards", data["AI Specific Security Standards"])}
          {renderField("Vulnerability Disclosure", data["Vulnerability Disclosure"])}
          {renderField("Recently Known Breaches/ Incidents / Public Issues", data["Recently Known Breaches/ Incidents / Public Issues"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Access Controls & Authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Supports SSO/SAML/SCIM", data["Supports SSO/SAML/SCIM"])}
          {renderField("Authentication Methods", data["Authentication Methods"])}
          {renderField("Supports RBAC (or some form of user permissions and roles)?", data["Supports RBAC (or some form of user permissions and roles)?"])}
          {renderField("APIs Available?", data["APIs Available?"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Security Support & Reporting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Bug Bounty System Available?", data["Bug Bounty System Available?"])}
          {renderField("Trust Contact Info (email ID if available)", data["Trust Contact Info (email ID if available)"])}
          {renderField("Other AI-Specific Terms / Disclosures", data["Other AI-Specific Terms / Disclosures"])}
        </CardContent>
      </Card>
    </div>
  );
}; 