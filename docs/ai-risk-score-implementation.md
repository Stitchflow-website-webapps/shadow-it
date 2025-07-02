# AI Risk Score Implementation

## Overview

The AI Risk Score feature calculates risk scores for applications based on AI risk data from the "AI-database-shadow-it" schema and organization-specific settings. This implementation provides a comprehensive risk assessment system that considers various factors like data privacy, security, business impact, AI governance, and vendor profile.

## Architecture

### Database Schema

#### 1. Organization Settings Table
```sql
CREATE TABLE shadow_it.organization_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bucket_weights jsonb NOT NULL,
  ai_multipliers jsonb NOT NULL,
  scope_multipliers jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

#### 2. Applications Table Enhancement
```sql
ALTER TABLE shadow_it.applications 
ADD COLUMN ai_risk_score DECIMAL(10,2) DEFAULT NULL;
```

### API Endpoints

#### 1. Organization Settings API (`/api/organization-settings`)
- **GET**: Retrieve organization settings by `org_id`
- **POST**: Create or update organization settings
- **DELETE**: Delete organization settings (reset to defaults)

#### 2. AI Risk Scores API (`/api/ai-risk-scores`)
- **GET**: Calculate AI risk scores for all applications in an organization
- **POST**: Calculate and optionally save AI risk scores to the database

## Risk Calculation Formula

The AI Risk Score is calculated using the following formula:

```
Final Score = Base Score × AI Amplification × Scope Amplification
```

Where:
- **Base Score**: Weighted average of 5 categories (Average 1-5 from AI risk data)
- **AI Amplification**: Multiplier based on AI-native status (native/partial/none)
- **Scope Amplification**: Multiplier based on application scope risk (high/medium/low)

### Categories and Weights

1. **Data Privacy & Handling** (Average 1) - Default weight: 20%
2. **Security & Access Controls** (Average 2) - Default weight: 25%
3. **Business Impact & Criticality** (Average 3) - Default weight: 20%
4. **AI Governance & Transparency** (Average 4) - Default weight: 20%
5. **Vendor Profile & Reliability** (Average 5) - Default weight: 15%

### Default Multipliers

#### AI Multipliers
- **Native AI**: Higher risk multipliers (1.2-1.6)
- **Partial AI**: Medium risk multipliers (1.0-1.3)
- **No AI**: Baseline multipliers (1.0)

#### Scope Multipliers
- **High Scope**: Higher risk multipliers (1.1-1.5)
- **Medium Scope**: Medium risk multipliers (1.0-1.2)
- **Low Scope**: Baseline multipliers (1.0)

## Implementation Steps

### 1. Database Setup
Run the following migrations:
```bash
# Create organization settings table
psql -d your_database -f migrations/create_organization_settings_table.sql

# Add AI risk score column to applications
psql -d your_database -f migrations/add_ai_risk_score_column.sql
```

### 2. API Usage Examples

#### Get Organization Settings
```javascript
fetch('/api/organization-settings?org_id=your-org-id')
  .then(response => response.json())
  .then(data => console.log(data));
```

#### Update Organization Settings
```javascript
fetch('/api/organization-settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    organization_id: 'your-org-id',
    bucket_weights: {
      dataPrivacy: 25,
      securityAccess: 30,
      businessImpact: 20,
      aiGovernance: 15,
      vendorProfile: 10
    },
    ai_multipliers: { /* ... */ },
    scope_multipliers: { /* ... */ }
  })
});
```

#### Calculate AI Risk Scores
```javascript
fetch('/api/ai-risk-scores?org_id=your-org-id')
  .then(response => response.json())
  .then(data => {
    console.log(`Applications with AI risk: ${data.applications_with_ai_risk}`);
    console.log(`Applications without AI risk: ${data.applications_without_ai_risk}`);
  });
```

#### Save AI Risk Scores to Database
```javascript
fetch('/api/ai-risk-scores', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    organization_id: 'your-org-id',
    update_database: true
  })
});
```

## Features

### 1. Fuzzy Matching
The system uses fuzzy matching to connect applications with AI risk data:
- Exact name matching (case-insensitive)
- Substring matching
- String similarity scoring (Jaccard similarity)

### 2. Default Settings
If no organization settings exist, the system uses default values that can be customized per organization.

### 3. Comprehensive Scoring
The scoring system considers:
- AI-native capabilities of the application
- Current risk level (scope) of the application
- Organizational priorities (custom weights)

### 4. Scalable Architecture
- Separate schemas for AI data and main application data
- Configurable organization settings
- Batch processing capabilities

## Integration Points

### Frontend Integration
The AI Risk Score can be displayed in:
- Applications table as a new column
- Risk assessment dashboards
- Application detail views
- Compliance reports

### CSV Import Integration
The existing CSV import functionality (`/api/applications/import-csv`) works seamlessly with the AI risk scoring system through the `org_apps` table.

## Troubleshooting

### Common Issues

1. **No AI Risk Scores Calculated**
   - Verify AI risk data exists in "AI-database-shadow-it" schema
   - Check application name matching with AI risk data
   - Ensure organization settings are properly configured

2. **Database Connection Issues**
   - Verify `SUPABASE_SERVICE_ROLE_KEY` environment variable
   - Check schema permissions for "AI-database-shadow-it"
   - Ensure both database connections are properly configured

3. **Fuzzy Matching Not Working**
   - Application names should be reasonably similar to AI risk data
   - Check for special characters or encoding issues
   - Review matching algorithm thresholds

## Future Enhancements

1. **Machine Learning Integration**: Use ML models for better application matching
2. **Real-time Updates**: Automatically recalculate scores when settings change
3. **Advanced Analytics**: Provide insights into risk score distributions
4. **Bulk Operations**: Support bulk updates and exports
5. **Audit Logging**: Track changes to organization settings and score calculations 