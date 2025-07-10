# Fix for Organization Foreign Key Constraint Error

## Problem
The error message indicates that the `org_id` `c98ce982-b9e1-4500-88bd-56b6c6141c27` doesn't exist in the `organizations` table, causing a foreign key constraint violation when trying to insert/update records in the `apps` table.

## Solution
You need to create the missing organization record in the database. Here are several ways to do this:

### Option 1: Using SQL (Recommended)
Execute the following SQL query in your Supabase SQL editor or database console:

```sql
-- Create the missing organization
INSERT INTO organizations (id, name, domain, auth_provider, created_at, updated_at, first_admin)
VALUES (
    'c98ce982-b9e1-4500-88bd-56b6c6141c27',
    'Default Organization',
    'default.com',
    'google',
    NOW(),
    NOW(),
    'system@default.com'
)
ON CONFLICT (id) DO NOTHING;

-- Verify the organization was created
SELECT id, name, domain, auth_provider, created_at FROM organizations 
WHERE id = 'c98ce982-b9e1-4500-88bd-56b6c6141c27';
```

### Option 2: Using the API Endpoint
1. First, set up the required environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Then call the fix endpoint:
   ```bash
   curl -X POST http://localhost:3000/api/fix-organization
   ```

### Option 3: Manual Database Access
1. Log into your Supabase dashboard
2. Go to the Table Editor
3. Navigate to the `organizations` table
4. Click "Insert" and add a new row with:
   - `id`: `c98ce982-b9e1-4500-88bd-56b6c6141c27`
   - `name`: `Default Organization`
   - `domain`: `default.com`
   - `auth_provider`: `google`
   - `created_at`: current timestamp
   - `updated_at`: current timestamp
   - `first_admin`: `system@default.com`

## Verification
After implementing the fix, verify that:
1. The organization exists in the database
2. The original error no longer occurs when trying to update the `apps` table
3. The API endpoint `PUT /api/organize/apps` works correctly

## Prevention
To prevent this issue in the future:
1. Ensure proper organization creation during user signup
2. Add validation to check for organization existence before creating app records
3. Consider adding cascade options to foreign key constraints if appropriate

## Files Modified
- Created: `app/api/fix-organization/route.ts` - API endpoint to fix the issue
- Created: `fix_missing_organization.sql` - SQL script to create the organization
- Created: `fix_missing_organization.js` - Node.js script (requires env variables)