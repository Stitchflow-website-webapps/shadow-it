import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessImpactData } from "@/types/ai_risk_application";

interface BusinessImpactTabProps {
  data: BusinessImpactData;
}

export const BusinessImpactTab: React.FC<BusinessImpactTabProps> = ({ data }) => {
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
        <h3 className="text-xl font-bold text-gray-900 mb-2">Business Impact & Risk</h3>
        <p className="text-sm text-gray-500 mb-6">Business criticality, risk assessment, and operational impact</p>
      </div>
      
      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Organizational Impact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Org Level Criticality (company wide/ specific usage)", data["Org Level Criticality (company wide/ specific usage)"])}
          {renderField("Departments/Teams Suitable for App Usage", data["Departments/Teams Suitable for App Usage"])}
          {renderField("Impact to Business (when app data/functionality is compromised)", data["Impact to Business (when app data/functionality is compromised)"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">User Experience & Adoption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("App Performance/Popularity Sentiment", data["App Performance/Popularity Sentiment"])}
          {renderField("Ease of App Setup", data["Ease of App Setup"])}
          {renderField("Need Employee Training Before Usage?", data["Need Employee Training Before Usage?"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Risk Assessment & Terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Overall Security Risk Factor & Tier", data["Overall Security Risk Factor & Tier"])}
          {renderField("Renewals & Upgrade Terms", data["Renewals & Upgrade Terms"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Additional Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Notes / Observations", data["Notes / Observations"])}
        </CardContent>
      </Card>
    </div>
  );
}; 