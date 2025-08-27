# Duplicate Organizations Issue - Root Cause and Solution

## Problem Description

The error you're seeing is:
```
Failed to update organization for shadow org ID: 06082830-06bf-4fb2-bfdd-d955ff996abc {
  code: 'PGRST116',
  details: 'The result contains 2 rows',
  hint: null,
  message: 'JSON object requested, multiple (or no) rows returned'
}
```

## Root Cause

The issue is that there are **duplicate organizations** in the `organize-app-inbox.organizations` table with the same `shadow_org_id`. When the API tries to update using `.eq('shadow_org_id', singleShadowOrgId).single()`, it finds multiple rows and throws the PGRST116 error.

This happens because:
1. The `shadow_org_id` column doesn't have a unique constraint
2. Multiple organizations can be created with the same `shadow_org_id`
3. The API code assumes there's only one organization per `shadow_org_id`

## Why This Happens

Looking at the codebase, this can occur in several scenarios:

1. **Multiple authentication flows**: When users authenticate multiple times, the system might create duplicate organizations
2. **Domain matching logic**: The auth routes (`/api/auth/google/route.ts` and `/api/auth/microsoft/route.ts`) have logic to merge organizations by domain, but this doesn't prevent duplicates with the same `shadow_org_id`
3. **Manual data entry**: Organizations might have been created manually with duplicate `shadow_org_id` values

## Immediate Fix (API Code)

I've updated the API code in `/api/organize/organization/route.ts` to handle duplicate organizations gracefully:

### Changes Made:

1. **GET Method**: Now fetches all organizations with the given `shadow_org_id` and uses the oldest one
2. **PUT Method**: Finds all matching organizations, logs a warning if duplicates exist, and updates the oldest organization

### Key Changes:
```typescript
// Before (causing PGRST116 error)
const { data: organization, error: orgError } = await organizeSupabaseAdmin
  .from('organizations')
  .select('*')
  .eq('shadow_org_id', singleShadowOrgId)
  .single() // ❌ Fails when multiple rows exist

// After (handles duplicates gracefully)
const { data: organizations, error: orgError } = await organizeSupabaseAdmin
  .from('organizations')
  .select('*')
  .eq('shadow_org_id', singleShadowOrgId)

// Use the oldest organization
const targetOrg = organizations.sort((a, b) => 
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
)[0]
```

## Long-term Fix (Database Cleanup)

To permanently resolve this issue, you need to clean up the duplicate organizations:

### Step 1: Analyze the Problem

Run the analysis script:
```bash
node scripts/analyze-duplicate-organizations.js
```

### Step 2: Run the SQL Analysis

Execute the SQL script to see the duplicates:
```sql
-- Run the analysis queries in fix_duplicate_organizations.sql
```

### Step 3: Clean Up Duplicates

For each set of duplicate organizations:

1. **Identify the primary organization** (usually the oldest one)
2. **Move all apps** from duplicate organizations to the primary one
3. **Delete the duplicate organizations**
4. **Add a unique constraint** to prevent future duplicates

### Step 4: Add Database Constraints

Add this constraint to prevent future duplicates:
```sql
ALTER TABLE "organize-app-inbox".organizations 
ADD CONSTRAINT organizations_unique_shadow_org_id 
UNIQUE (shadow_org_id);
```

## Files Created/Modified

### New Files:
- `fix_duplicate_organizations.sql` - SQL script to analyze and fix duplicates
- `scripts/analyze-duplicate-organizations.js` - Node.js script to analyze duplicates
- `docs/duplicate-organizations-fix.md` - This documentation

### Modified Files:
- `app/api/organize/organization/route.ts` - Updated to handle duplicate organizations

## Testing the Fix

1. **Test the API**: The IDP settings should now work even with duplicate organizations
2. **Monitor logs**: Check for warnings about duplicate organizations
3. **Verify functionality**: Ensure all features work correctly

## Prevention

To prevent this issue in the future:

1. **Add unique constraint** on `shadow_org_id` column
2. **Improve auth logic** to better handle organization merging
3. **Add validation** in the API to check for duplicates before creating new organizations
4. **Regular monitoring** to detect and fix duplicates early

## Next Steps

1. ✅ **Immediate fix applied** - API now handles duplicates gracefully
2. 🔄 **Run analysis** - Use the provided scripts to understand the scope
3. 🧹 **Clean up duplicates** - Execute the SQL cleanup script
4. 🔒 **Add constraints** - Prevent future duplicates
5. 🧪 **Test thoroughly** - Ensure all functionality works correctly

The IDP settings should now work correctly, and you'll see warnings in the logs if duplicate organizations are detected, but the API won't fail.
