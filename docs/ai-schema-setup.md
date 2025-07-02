# AI Schema Service Setup

## Environment Variables Required

Add these environment variables to your `.env.local` file:

```bash
# Supabase Configuration for AI Schema
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Database Schema Setup

Ensure your Supabase project has the "AI-database-shadow-it" schema with:

1. `ai_risk_scores` table with columns:
   - `app_id` (integer, primary key)
   - `Tool Name` (text)
   - Other columns as per your existing schema

2. `org_apps` table (created via migration):
   - `id` (serial, primary key)
   - `org_id` (text)
   - `app_id` (integer, foreign key to ai_risk_scores.app_id)
   - `created_at` (timestamp)
   - `updated_at` (timestamp)

## Run Migration

If you haven't already, run the org_apps migration:

```bash
# If using Supabase CLI
supabase migration up

# Or execute the SQL directly in your Supabase dashboard
# File: migrations/org_app.sql
```

## Test the Service

### 1. Prepare a test CSV file (test-apps.csv):
```csv
Tool Name,Category,Users
Zoom,Communication,150
Slack,Communication,200
GitHub,Development,80
Figma,Design,45
```

### 2. Test the endpoint:
```bash
curl -X POST \
  -H "x-org-id: test-org-123" \
  -F "csv=@test-apps.csv" \
  http://localhost:3000/api/applications/import-csv
```

## Deployment Commands

### For Vercel:
```bash
# Set environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY

# Deploy
vercel --prod
```

### For other platforms:
Ensure these environment variables are set in your deployment platform:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Service Permissions

Make sure your Supabase service role key has permissions to:
- Read from `ai_risk_scores` table in "AI-database-shadow-it" schema
- Write to `org_apps` table in "AI-database-shadow-it" schema

## Troubleshooting

### Common Issues:
1. **Schema not found**: Ensure "AI-database-shadow-it" schema exists in your Supabase project
2. **Permission denied**: Verify service role key has proper permissions
3. **Column not found**: Check that "Tool Name" column exists in ai_risk_scores table
4. **Foreign key constraint**: Ensure app_id in ai_risk_scores matches the constraint in org_apps

### Debug Mode:
Check the browser console or server logs for detailed error messages when testing the endpoint. 