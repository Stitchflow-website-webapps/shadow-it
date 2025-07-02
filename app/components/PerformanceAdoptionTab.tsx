import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceAdoptionData } from "@/types/ai_risk_application";

interface PerformanceAdoptionTabProps {
  data: PerformanceAdoptionData;
}

export const PerformanceAdoptionTab: React.FC<PerformanceAdoptionTabProps> = ({ data }) => {
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
        <h3 className="text-xl font-bold text-gray-900 mb-2">Performance & Adoption</h3>
        <p className="text-sm text-gray-500 mb-6">Market position, adoption metrics, and performance indicators</p>
      </div>
      
      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Market Position</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Global Adoption Rank", data["Global Adoption Rank"])}
          {renderField("No. of Active Customers (Reported)", data["No. of Active Customers (Reported)"])}
          {renderField("Popularity percentage", data["Popularity percentage"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Industry Adoption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Benchmark Usage by Peers", data["Benchmark Usage by Peers"])}
          {renderField("Stack Inclusion Rate", data["Stack Inclusion Rate"])}
        </CardContent>
      </Card>

      <Card className="border-gray-200">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-gray-900">Ecosystem & Alternatives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {renderField("Best paired with", data["Best paired with"])}
          {renderField("Other popular apps in this space", data["Other popular apps in this space"])}
        </CardContent>
      </Card>
    </div>
  );
}; 