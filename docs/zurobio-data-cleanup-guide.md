# Zurobio Data Cleanup Guide: Fixing Microsoft User-App Relationships

## Overview

Zurobio's Microsoft sync has incorrect user-app relationships due to the admin consent issue. This guide provides tools to clean up the existing data **without requiring them to reconnect their Microsoft account**.

## The Problem

- **Current State**: Okta shows 331 users (all users in tenant)
- **Expected State**: Okta should show only users with actual assignments (likely 5-20 users)
- **Root Cause**: Admin consent was incorrectly interpreted as user access

## Solution: Data Cleanup Tools

We've created two tools to fix this:

### 1. API Endpoint: `/api/admin/cleanup-microsoft-user-apps`
- **Purpose**: Automated cleanup with Microsoft Graph validation
- **Features**: Dry run mode, detailed analysis, batch processing
- **Safety**: Validates against actual Microsoft assignments

### 2. Script: `scripts/cleanup-zurobio-microsoft-data.js`
- **Purpose**: Command-line tool for finding and analyzing Zurobio's data
- **Features**: Organization discovery, analysis, cleanup execution

## Step-by-Step Cleanup Process

### Step 1: Find Zurobio Organization

```bash
cd /Users/thamim/shadow-it
node scripts/cleanup-zurobio-microsoft-data.js
```

**Expected Output:**
```
🔍 Searching for Zurobio organization...
   ✅ Found 1 organization(s):
      - Zurobio Inc (zurobio.com) - ID: abc123-def456-ghi789

📊 Analyzing organization: abc123-def456-ghi789
✅ Organization: Zurobio Inc (zurobio.com)
   Total Users: 331
   Total Applications: 64

📱 Top applications by user count:
      Okta: 331 users
      DocuSign: 331 users
      Zoom: 331 users

⚠️  Suspicious applications (high user count):
      Okta: 331/331 users (100%)
      DocuSign: 331/331 users (100%)
```

### Step 2: Run Analysis (Dry Run)

```bash
node scripts/cleanup-zurobio-microsoft-data.js --analyze
```

**Expected Output:**
```
🧹 Running cleanup analysis for organization: abc123-def456-ghi789
🔍 Mode: DRY RUN (analysis only)

📊 Cleanup Analysis Results:
   Total relationships: 2,156
   Relationships to keep: 156
   Relationships to remove: 2,000
   Users with actual assignments: 45

📱 Application breakdown:
   Okta:
      Keep: 8 users
      Remove: 323 users
   DocuSign:
      Keep: 15 users
      Remove: 316 users
   Zoom:
      Keep: 25 users
      Remove: 306 users
```

### Step 3: Execute Cleanup (If Analysis Looks Good)

```bash
node scripts/cleanup-zurobio-microsoft-data.js --cleanup --execute
```

**Expected Output:**
```
🗑️ Removing 2,000 incorrect relationships...
✅ Removed batch 1/40 (50 relationships)
✅ Removed batch 2/40 (50 relationships)
...
✅ Successfully removed 2,000 incorrect relationships

🔄 Updating application user counts...
🎉 Cleanup execution completed successfully
```

## How the Cleanup Works

### 1. Microsoft Graph Validation
The cleanup tool:
1. **Connects to Microsoft Graph** using existing credentials
2. **Fetches actual user assignments** via `/users/{id}/appRoleAssignments`
3. **Compares with database** relationships
4. **Identifies incorrect relationships** (admin consent without actual assignment)

### 2. Safe Removal Process
- **Batch processing**: Removes relationships in small batches
- **Error handling**: Continues on errors, logs issues
- **User count updates**: Recalculates application user counts
- **Audit trail**: Logs all actions for review

### 3. Validation Logic
A user-app relationship is **kept** if:
- User has actual `appRoleAssignment` in Microsoft
- User has given individual consent to the app

A user-app relationship is **removed** if:
- Only admin consent exists (no actual user assignment)
- User never interacted with the app directly

## Expected Results After Cleanup

### Before Cleanup
```
Okta: 331 users ❌
DocuSign: 331 users ❌
Zoom: 331 users ❌
Total Relationships: 2,156
```

### After Cleanup
```
Okta: 8 users ✅
DocuSign: 15 users ✅
Zoom: 25 users ✅
Total Relationships: 156
```

## Safety Measures

### 1. Dry Run First
- **Always run analysis** before executing cleanup
- **Review the output** to ensure it makes sense
- **Check suspicious patterns** before proceeding

### 2. Backup Strategy
```sql
-- Create backup before cleanup
CREATE TABLE user_applications_backup_zurobio AS 
SELECT * FROM user_applications ua
JOIN applications a ON ua.application_id = a.id
WHERE a.organization_id = 'zurobio-org-id';
```

### 3. Rollback Plan
If something goes wrong:
```sql
-- Restore from backup
INSERT INTO user_applications 
SELECT id, user_id, application_id, scopes, created_at, updated_at 
FROM user_applications_backup_zurobio;
```

## Verification Steps

### 1. Check Application User Counts
```sql
SELECT 
  a.name,
  COUNT(ua.user_id) as actual_user_count,
  a.user_count as stored_user_count
FROM applications a
LEFT JOIN user_applications ua ON a.id = ua.application_id
WHERE a.organization_id = 'zurobio-org-id'
GROUP BY a.id, a.name, a.user_count
ORDER BY actual_user_count DESC;
```

### 2. Verify Specific Applications
```sql
-- Check Okta specifically
SELECT 
  u.email,
  ua.scopes
FROM user_applications ua
JOIN users u ON ua.user_id = u.id
JOIN applications a ON ua.application_id = a.id
WHERE a.name = 'Okta' 
  AND a.organization_id = 'zurobio-org-id';
```

### 3. Compare with Microsoft Entra ID
1. Go to **Microsoft Entra admin center**
2. Navigate to **Enterprise applications**
3. Find **Okta** → **Users and groups**
4. Count should match database results

## Troubleshooting

### Issue: "No Microsoft sync credentials found"
**Solution**: Ensure Zurobio has completed at least one Microsoft sync
```sql
SELECT * FROM sync_status 
WHERE organization_id = 'zurobio-org-id' 
  AND provider = 'microsoft';
```

### Issue: "Could not refresh Microsoft tokens"
**Solution**: Tokens may have expired, need fresh authentication
- This is rare if they've synced recently
- May need to ask for re-authentication if tokens are very old

### Issue: Cleanup removes too many relationships
**Solution**: Check the analysis output carefully
- Verify the organization ID is correct
- Check if Microsoft assignments are properly configured
- Run dry run multiple times to ensure consistency

## Communication with Zurobio

### Before Cleanup
> "We've identified the cause of the inflated user counts and have developed a solution to fix the existing data without requiring you to reconnect your Microsoft account. We'll run a careful analysis first to show you exactly what will be changed."

### After Analysis
> "Our analysis shows that of your 331 users, only 45 actually have assignments to applications. For example, Okta currently shows 331 users but only 8 actually have access. We can clean this up automatically while preserving all legitimate access."

### After Cleanup
> "We've successfully cleaned up your data. Your application user counts now accurately reflect actual access:
> - Okta: 8 users (was 331)
> - DocuSign: 15 users (was 331)
> - Total relationships: 156 (was 2,156)
> 
> No actual user access was affected - we only removed false relationships created by the admin consent issue."

## Monitoring & Follow-up

### 1. Verify Next Sync
- Monitor the next Microsoft sync for Zurobio
- Ensure user counts remain accurate
- Check that new relationships are created correctly

### 2. Apply to Other Clients
This same issue likely affects other Microsoft clients:
```sql
-- Find organizations with suspicious patterns
SELECT 
  o.name,
  o.domain,
  COUNT(ua.id) as total_relationships,
  COUNT(DISTINCT u.id) as unique_users,
  COUNT(DISTINCT a.id) as unique_apps
FROM organizations o
JOIN users u ON o.id = u.organization_id
JOIN user_applications ua ON u.id = ua.user_id
JOIN applications a ON ua.application_id = a.id
WHERE o.auth_provider = 'microsoft'
GROUP BY o.id, o.name, o.domain
HAVING COUNT(ua.id) > (COUNT(DISTINCT u.id) * 5) -- More than 5 apps per user on average
ORDER BY total_relationships DESC;
```

---

**Status**: Ready for execution  
**Risk Level**: Low (dry run first, backup available)  
**Estimated Time**: 10-15 minutes for analysis, 5-10 minutes for cleanup  
**Impact**: Fixes user count accuracy without affecting actual access
