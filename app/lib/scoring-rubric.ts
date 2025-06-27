// Comprehensive Risk Scoring Rubric
// Defines what each score (1-5) means for every criteria across all categories
// 1 = Lowest Risk, 5 = Highest Risk

export interface ScoreDefinition {
    score: number;
    level: "Very Low" | "Low" | "Medium" | "High" | "Very High";
    description: string;
  }
  
  export interface CriteriaRubric {
    name: string;
    definitions: ScoreDefinition[];
  }
  
  export interface CategoryRubric {
    name: string;
    weight: number; // default weight percentage
    criteria: CriteriaRubric[];
  }
  
  export const riskScoringRubric: Record<string, CategoryRubric> = {
    dataPrivacy: {
      name: "Data Privacy & Handling",
      weight: 30,
      criteria: [
        {
          name: "Data Sensitivity",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "No sensitive data processed; only public information; clear data minimization practices"
            },
            {
              score: 2,
              level: "Low", 
              description: "Limited sensitive data; strong retention policies; comprehensive deletion options"
            },
            {
              score: 3,
              level: "Medium",
              description: "Moderate sensitive data exposure; adequate retention policies; some deletion options"
            },
            {
              score: 4,
              level: "High",
              description: "Significant data exposure; vague retention policies; limited deletion options"
            },
            {
              score: 5,
              level: "Very High",
              description: "Extensive sensitive/PII data; unclear retention; no deletion options; potential for data misuse"
            }
          ]
        },
        {
          name: "Data Residency",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Data stored in preferred regions; full control over location; comprehensive documentation"
            },
            {
              score: 2,
              level: "Low",
              description: "Data in acceptable regions; good location controls; clear documentation"
            },
            {
              score: 3,
              level: "Medium",
              description: "Limited regional options but clear documentation on data location"
            },
            {
              score: 4,
              level: "High",
              description: "Data stored in concerning regions; limited location visibility; unclear documentation"
            },
            {
              score: 5,
              level: "Very High",
              description: "Data in prohibited regions; no location control; no documentation on data residency"
            }
          ]
        },
        {
          name: "Training Data Usage",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Explicit opt-out from training; clear data usage policies; customer data never used for training"
            },
            {
              score: 2,
              level: "Low",
              description: "Clear policies against using customer data for training; good transparency"
            },
            {
              score: 3,
              level: "Medium",
              description: "Some clarity on training data usage; limited customer data use"
            },
            {
              score: 4,
              level: "High",
              description: "Unclear policies on customer data usage for training"
            },
            {
              score: 5,
              level: "Very High",
              description: "Customer data explicitly used for training; no opt-out options; unclear usage scope"
            }
          ]
        },
        {
          name: "Policy Transparency",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Comprehensive, clear policies; detailed privacy documentation; regular updates communicated"
            },
            {
              score: 2,
              level: "Low",
              description: "Clear policies with good detail; accessible documentation; regular updates"
            },
            {
              score: 3,
              level: "Medium",
              description: "Policies available but lack detail/clarity"
            },
            {
              score: 4,
              level: "High",
              description: "Vague policies; limited documentation; unclear terms and conditions"
            },
            {
              score: 5,
              level: "Very High",
              description: "No clear policies; missing documentation; frequently changing terms without notice"
            }
          ]
        }
      ]
    },
  
    securityAccess: {
      name: "Security & Access Controls",
      weight: 25,
      criteria: [
        {
          name: "Security Certifications",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Multiple relevant certifications (SOC2, ISO27001, etc.); regular audits; comprehensive compliance"
            },
            {
              score: 2,
              level: "Low",
              description: "Strong security certifications relevant to the service"
            },
            {
              score: 3,
              level: "Medium",
              description: "Some security certifications; adequate compliance framework"
            },
            {
              score: 4,
              level: "High",
              description: "Limited certifications; unclear compliance status; outdated security standards"
            },
            {
              score: 5,
              level: "Very High",
              description: "No relevant certifications; no compliance framework; poor security posture"
            }
          ]
        },
        {
          name: "Vulnerability Management",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Proactive vulnerability management; regular penetration testing; rapid response to issues"
            },
            {
              score: 2,
              level: "Low",
              description: "Good vulnerability management; regular security assessments; timely patching"
            },
            {
              score: 3,
              level: "Medium",
              description: "Standard vulnerability handling procedures"
            },
            {
              score: 4,
              level: "High",
              description: "Reactive vulnerability management; slow response times; irregular assessments"
            },
            {
              score: 5,
              level: "Very High",
              description: "Poor vulnerability management; no regular assessments; slow or no response to security issues"
            }
          ]
        },
        {
          name: "Authentication & Access",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Advanced authentication (MFA, SSO); granular role-based access; comprehensive audit logs"
            },
            {
              score: 2,
              level: "Low",
              description: "Strong authentication methods; good role-based permissions; audit capabilities"
            },
            {
              score: 3,
              level: "Medium",
              description: "Standard auth methods; basic role-based permissions"
            },
            {
              score: 4,
              level: "High",
              description: "Basic authentication; limited access controls; poor permission management"
            },
            {
              score: 5,
              level: "Very High",
              description: "Weak authentication; no role-based access; shared accounts; no audit trail"
            }
          ]
        },
        {
          name: "Breach History",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "No known breaches; excellent security track record; proactive security measures"
            },
            {
              score: 2,
              level: "Low",
              description: "No significant breaches; good security track record; transparent incident handling"
            },
            {
              score: 3,
              level: "Medium",
              description: "Moderate breaches with adequate response"
            },
            {
              score: 4,
              level: "High",
              description: "Multiple breaches; slow response times; inadequate remediation"
            },
            {
              score: 5,
              level: "Very High",
              description: "Frequent breaches; poor incident response; lack of transparency; ongoing security issues"
            }
          ]
        }
      ]
    },
  
    businessImpact: {
      name: "Business Impact & Criticality",
      weight: 20,
      criteria: [
        {
          name: "Operational Importance",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Non-critical tool; multiple alternatives available; minimal business disruption if unavailable"
            },
            {
              score: 2,
              level: "Low",
              description: "Useful but not essential; alternatives exist; limited business impact"
            },
            {
              score: 3,
              level: "Medium",
              description: "Important for operations; some alternatives available; moderate business impact"
            },
            {
              score: 4,
              level: "High",
              description: "Significant business impact; limited alternatives"
            },
            {
              score: 5,
              level: "Very High",
              description: "Mission-critical; no alternatives; severe business disruption if unavailable"
            }
          ]
        },
        {
          name: "Data Criticality",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Processes only public or non-sensitive data"
            },
            {
              score: 2,
              level: "Low",
              description: "Processes limited internal data; low sensitivity"
            },
            {
              score: 3,
              level: "Medium",
              description: "Processes moderate internal data; some sensitive information"
            },
            {
              score: 4,
              level: "High",
              description: "Processes highly sensitive internal data"
            },
            {
              score: 5,
              level: "Very High",
              description: "Processes critical business data, PII, financial data, or intellectual property"
            }
          ]
        },
        {
          name: "User Base & Scope",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Individual or small team use; limited scope; no external exposure"
            },
            {
              score: 2,
              level: "Low",
              description: "Department-level use; internal only; controlled access"
            },
            {
              score: 3,
              level: "Medium",
              description: "Multiple departments; broader internal use"
            },
            {
              score: 4,
              level: "High",
              description: "Company-wide deployment or customer-facing"
            },
            {
              score: 5,
              level: "Very High",
              description: "Enterprise-wide critical system; external customer access; high visibility"
            }
          ]
        }
      ]
    },
  
    aiGovernance: {
      name: "AI Governance & Transparency",
      weight: 15,
      criteria: [
        {
          name: "Model Transparency",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Full transparency; open source models; clear documentation of capabilities and limitations"
            },
            {
              score: 2,
              level: "Low",
              description: "Good transparency; clear model documentation; known training data sources"
            },
            {
              score: 3,
              level: "Medium",
              description: "Some transparency; basic model information available"
            },
            {
              score: 4,
              level: "High",
              description: "Limited transparency or unclear functionality"
            },
            {
              score: 5,
              level: "Very High",
              description: "Black box model; no transparency; unknown capabilities or training data"
            }
          ]
        },
        {
          name: "Human Oversight",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Comprehensive human oversight; human-in-the-loop for all decisions; clear escalation"
            },
            {
              score: 2,
              level: "Low",
              description: "Good human oversight with clear escalation procedures"
            },
            {
              score: 3,
              level: "Medium",
              description: "Some human oversight; basic review processes"
            },
            {
              score: 4,
              level: "High",
              description: "Limited human oversight; unclear review processes"
            },
            {
              score: 5,
              level: "Very High",
              description: "No human oversight; fully automated decisions; no review or appeal process"
            }
          ]
        },
        {
          name: "Model Provenance",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Internal/private AI with full control and known training data"
            },
            {
              score: 2,
              level: "Low",
              description: "Trusted third-party model with clear provenance and training data"
            },
            {
              score: 3,
              level: "Medium",
              description: "Mix (e.g., Private AI but 3rd party model)"
            },
            {
              score: 4,
              level: "High",
              description: "Third-party model with limited provenance information"
            },
            {
              score: 5,
              level: "Very High",
              description: "Unknown model source; unclear training data; potential bias or manipulation"
            }
          ]
        },
        {
          name: "User Opt-Out Options",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Full opt-out capabilities; granular controls; easy to disable AI features"
            },
            {
              score: 2,
              level: "Low",
              description: "Good opt-out options; clear controls for AI features"
            },
            {
              score: 3,
              level: "Medium",
              description: "Limited opt-out options available"
            },
            {
              score: 4,
              level: "High",
              description: "Minimal opt-out options; difficult to disable AI features"
            },
            {
              score: 5,
              level: "Very High",
              description: "No opt-out options; mandatory AI processing; no user control"
            }
          ]
        }
      ]
    },
  
    vendorProfile: {
      name: "Vendor Profile & Reliability",
      weight: 10,
      criteria: [
        {
          name: "Company Stability",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Established company; strong financials; excellent market position; long track record"
            },
            {
              score: 2,
              level: "Low",
              description: "Well-funded company; good market position"
            },
            {
              score: 3,
              level: "Medium",
              description: "Stable company; adequate funding; reasonable market position"
            },
            {
              score: 4,
              level: "High",
              description: "Uncertain financial stability; weak market position; limited track record"
            },
            {
              score: 5,
              level: "Very High",
              description: "Financial instability; poor market position; high risk of business failure"
            }
          ]
        },
        {
          name: "Support & Documentation",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Excellent support; comprehensive documentation; multiple support channels; SLA guarantees"
            },
            {
              score: 2,
              level: "Low",
              description: "Good support options; thorough documentation"
            },
            {
              score: 3,
              level: "Medium",
              description: "Adequate support; basic documentation; reasonable response times"
            },
            {
              score: 4,
              level: "High",
              description: "Limited support options; poor documentation; slow response times"
            },
            {
              score: 5,
              level: "Very High",
              description: "No support; missing documentation; community-only support; no SLA"
            }
          ]
        },
        {
          name: "Integration Complexity",
          definitions: [
            {
              score: 1,
              level: "Very Low",
              description: "Simple integration; excellent APIs; comprehensive SDKs; minimal technical requirements"
            },
            {
              score: 2,
              level: "Low",
              description: "Easy integration; good APIs; clear documentation"
            },
            {
              score: 3,
              level: "Medium",
              description: "Standard integration complexity; adequate APIs"
            },
            {
              score: 4,
              level: "High",
              description: "Complex integration; limited APIs; poor documentation; significant technical effort"
            },
            {
              score: 5,
              level: "Very High",
              description: "Very complex integration; no APIs; custom development required; high technical risk"
            }
          ]
        }
      ]
    }
  };
  
  // Helper function to get score definition for a specific criteria
  export function getScoreDefinition(category: string, criteria: string, score: number): ScoreDefinition | null {
    const categoryRubric = riskScoringRubric[category];
    if (!categoryRubric) return null;
    
    const criteriaRubric = categoryRubric.criteria.find(c => c.name === criteria);
    if (!criteriaRubric) return null;
    
    return criteriaRubric.definitions.find(d => d.score === score) || null;
  }
  
  // Helper function to get all possible scores for a criteria
  export function getCriteriaRubric(category: string, criteria: string): CriteriaRubric | null {
    const categoryRubric = riskScoringRubric[category];
    if (!categoryRubric) return null;
    
    return categoryRubric.criteria.find(c => c.name === criteria) || null;
  }