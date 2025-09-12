import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AITechnologyData } from "@/types/ai_risk_application";

interface AITechnologyTabProps {
  data: AITechnologyData;
}

export const AITechnologyTab: React.FC<AITechnologyTabProps> = ({ data }) => {
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
        <h3 className="text-xl font-bold text-gray-900 mb-2">AI & Technology</h3>
        <p className="text-sm text-gray-500 mb-6">Detailed information about AI & technology</p>
      </div>
      
      <Card className="border-gray-200 hover-card transition-all duration-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">AI Features & Implementation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Key AI Features", data["Key AI Features"])}
          {renderField("Proprietary Model or 3rd Party?", data["Proprietary Model or 3rd Party?"])}
          {renderField("AI Model Hosting Location / Data Residency", data["AI Model Hosting Location / Data Residency"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200 hover-card transition-all duration-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Data Handling & Privacy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Data Sent to AI Model?", data["Data Sent to AI Model?"])}
          {renderField("Type of Data Sent", data["Type of Data Sent"])}
          {renderField("Customer/Org Data Used for Model Training?", data["Customer/Org Data Used for Model Training?"])}
          {renderField("User Opt-Out of AI?", data["User Opt-Out of AI?"])}
        </CardContent>
      </Card>
    </div>
  );
}; 