# Weekly Google Suspended/Archived Users Cleanup System

## Overview

This system automatically removes suspended users and archived users from Google Workspace organizations in your database every Monday at 12 AM. It also cleans up their associated user-application relationships and removes applications that become empty as a result.

## Components

### 1. Google Workspace Service Updates
**File**: `lib/google-workspace.ts`

**Updates**:
- Enhanced `getUsersList()` method with filtering parameters
- Enhanced `getUsersListPaginated()` method with filtering parameters
- Support for filtering suspended users (`suspended: true`)
- Support for filtering archived users (`archived: true`)

**New Method Signatures**:
```typescript
async getUsersList(includeSuspended: boolean = false, includeArchived: boolean = false)
async getUsersListPaginated(includeSuspended: boolean = false, includeArchived: boolean = false)
```

### 2. Updated Google Sync Scripts
**Files**:
- `app/api/background/sync/users/route.ts`
- `app/api/background/test-cron-google/route.ts`

**Updates**:
- Now use environment variables for user filtering preferences
- Filter out suspended and archived users by default
- Consistent with Microsoft sync behavior

### 3. Google Cleanup Script
**File**: `app/api/admin/cleanup-google-suspended-archived-users/route.ts`

**Purpose**: Processes Google organizations to remove suspended/archived users and their relationships.

**Features**:
- Detects suspended, archived, and hard-deleted users
- Hard-deleted user detection using reverse comparison (DB vs Google API)
- Removes these users from the database
- Removes their user-application relationships
- Removes applications that become empty after cleanup
- **Automatically recalculates application risk levels** after user removal
- Supports dry run mode for testing
- Retry logic for failed organizations (up to 2 retries)
- Comprehensive logging

### 4. Updated Weekly Cron Endpoint
**File**: `app/api/cron/weekly-microsoft-cleanup/route.ts` (now handles both providers)

**Purpose**: Scheduled endpoint for Upstash to trigger weekly cleanup for both Microsoft and Google.

**Features**:
- Processes both Microsoft and Google organizations
- Authenticated with CRON_SECRET or Upstash signature
- Supports both POST (live) and GET (dry run) methods
- Returns combined summary statistics

## Environment Variables

### Google User Filtering (New)
```bash
# Include suspended users in sync (default: false)
GOOGLE_INCLUDE_SUSPENDED=false

# Include archived users in sync (default: false)  
GOOGLE_INCLUDE_ARCHIVED=false
```

### Existing Variables
```bash
# Microsoft user filtering
MICROSOFT_INCLUDE_GUESTS=false
MICROSOFT_INCLUDE_DISABLED=false

# Cron authentication
CRON_SECRET=your_cron_secret_key

# Google Workspace credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_google_redirect_uri
```

## Google User Types

### Suspended Users
- Users with `suspended: true` in Google Workspace
- Account is temporarily disabled but not deleted
- Cannot sign in to Google Workspace services
- Can be reactivated by administrators

### Archived Users
- Users with `archived: true` in Google Workspace
- Account has been soft-deleted/archived
- Cannot sign in and data may be scheduled for deletion
- Typically former employees or deactivated accounts

### Default Behavior
- **Suspended users**: Excluded from sync by default
- **Archived users**: Excluded from sync by default
- **Result**: Only active organization members are synced

## Setup Instructions

### 1. Environment Variables
Make sure these are set in your environment:
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_google_redirect_uri
CRON_SECRET=your_cron_secret_key

# Optional: User filtering preferences
GOOGLE_INCLUDE_SUSPENDED=false
GOOGLE_INCLUDE_ARCHIVED=false
```

### 2. Upstash Cron Job Setup
The existing cron job now handles both Microsoft and Google:

1. Go to [Upstash Console](https://console.upstash.com/)
2. Navigate to QStash → Schedules
3. Update existing schedule or create new:
   - **Name**: `weekly-cleanup-all-providers`
   - **Destination**: `https://your-domain.com/api/cron/weekly-microsoft-cleanup`
   - **Cron Expression**: `0 0 * * 1` (Every Monday at 12:00 AM UTC)
   - **Method**: `POST`
   - **Headers**: 
     - `Authorization: Bearer your_cron_secret_key`
     - `Content-Type: application/json`

## Usage

### Manual Testing (Dry Run)

#### Test Google cleanup specifically:
```bash
# Test specific organization
curl -X POST https://your-domain.com/api/admin/cleanup-google-suspended-archived-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true,
    "organization_id": "specific-org-id"
  }'

# Test all Google organizations
curl -X POST https://your-domain.com/api/admin/cleanup-google-suspended-archived-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true
  }'
```

#### Test combined cleanup (Microsoft + Google):
```bash
# Dry run test for all providers
curl -X GET https://your-domain.com/api/cron/weekly-microsoft-cleanup \
  -H "Authorization: Bearer your_cron_secret"

# Live run test (be careful!)
curl -X POST https://your-domain.com/api/cron/weekly-microsoft-cleanup \
  -H "Authorization: Bearer your_cron_secret"
```

### Live Execution
Run actual cleanup (removes data):

```bash
# Google organizations only
curl -X POST https://your-domain.com/api/admin/cleanup-google-suspended-archived-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": false
  }'
```

## What Gets Cleaned Up

### 1. Users Removed
- **Suspended Users**: Users with `suspended = true`
- **Archived Users**: Users with `archived = true`

### 2. Relationships Removed
- All `user_applications` records for removed users

### 3. Applications Removed
- Applications that have **zero users** after cleanup
- Only applications that become empty due to this cleanup process
- Does not remove pre-existing empty applications

## Process Flow

1. **Fetch Organizations**: Get all Google organizations from database
2. **For Each Organization** (with 1-minute delay between orgs):
   - Get Google credentials and initialize service
   - Fetch suspended and archived users from Google Workspace API
   - Find these users in our database
   - Remove their `user_applications` relationships
   - Remove the users from `users` table
   - Check for applications that became empty
   - Remove empty applications
   - Retry up to 2 times if errors occur
   - Log all actions taken

## Google Workspace API Filtering

### API Query Used
```typescript
// For suspended users
query: "isSuspended=false"  // Excludes suspended users

// For archived users
// Filtered in response processing since API doesn't support archived filter
users = users.filter(user => !user.archived)
```

### User Breakdown Logging
The system logs detailed user breakdowns:
```
📊 User breakdown: {
  "Active (Live)": 80,
  "Suspended (Live)": 5,
  "Active (Archived)": 0,
  "Suspended (Archived)": 2
}
```

## Error Handling

### Retry Logic
- Each organization gets up to 2 retry attempts
- 5-second delay between retry attempts
- If all retries fail, moves to next organization
- Failed organizations are logged with error details

### Google API Errors
- Rate limiting handled by built-in RateLimiter
- Token refresh handled automatically
- Quota errors retry with exponential backoff

### Timeout Protection
- Main cleanup script: 1 hour timeout
- Individual organization processing continues even if one fails
- Comprehensive error logging for debugging

## Response Format

### Success Response (Google Cleanup)
```json
{
  "success": true,
  "dryRun": false,
  "summary": {
    "totalOrganizations": 3,
    "successfulOrganizations": 3,
    "failedOrganizations": 0,
    "totalRemovedUsers": 12,
    "totalRemovedRelationships": 45,
    "totalRemovedApplications": 2,
    "totalSuspendedUsers": 8,
    "totalArchivedUsers": 4
  },
  "results": [
    {
      "organizationId": "org-123",
      "organizationName": "Example Corp",
      "organizationDomain": "example.com",
      "success": true,
      "removedUsers": 4,
      "removedRelationships": 15,
      "removedApplications": 1,
      "suspendedUsers": 3,
      "archivedUsers": 1,
      "retryCount": 0,
      "details": {
        "removedUserEmails": ["suspended@example.com", "archived@example.com"],
        "removedApplicationNames": ["Unused App"],
        "relationshipsByApp": {
          "Slack": 8,
          "Unused App": 7
        }
      }
    }
  ]
}
```

### Combined Cron Response
```json
{
  "success": true,
  "message": "Weekly cleanup completed for all providers",
  "timestamp": "2025-01-20T00:00:00.000Z",
  "summary": {
    "microsoft": {
      "totalOrganizations": 5,
      "successfulOrganizations": 5,
      "totalRemovedUsers": 25,
      "totalRemovedRelationships": 150,
      "totalRemovedApplications": 3
    },
    "google": {
      "totalOrganizations": 3,
      "successfulOrganizations": 3,
      "totalRemovedUsers": 12,
      "totalRemovedRelationships": 45,
      "totalRemovedApplications": 2
    },
    "totalOrganizations": 8,
    "totalSuccessfulOrganizations": 8,
    "totalRemovedUsers": 37,
    "totalRemovedRelationships": 195,
    "totalRemovedApplications": 5
  },
  "microsoftSuccess": true,
  "googleSuccess": true
}
```

## Monitoring

### Logs to Monitor
- Organization processing progress
- User and relationship removal counts
- Application removal decisions
- Retry attempts and failures
- Google Workspace API calls and rate limiting

### Key Metrics
- Total organizations processed (Microsoft + Google)
- Success/failure rates per provider
- Users removed (suspended vs archived)
- Relationships removed
- Applications removed
- Processing time per organization

## Safety Features

### Dry Run Mode
- Always test with `dry_run: true` first
- Shows what would be removed without making changes
- Full logging of planned actions

### Selective Processing
- Can target specific organization with `organization_id`
- Processes all Google orgs if no specific org provided

### Conservative Application Removal
- Only removes applications that become empty due to this cleanup
- Does not touch pre-existing empty applications
- Prevents accidental removal of legitimate empty apps

### User Type Validation
- Validates user status using multiple Google API fields
- Cross-references suspended and archived flags
- Detailed logging of user types found

## Comparison: Microsoft vs Google

| Feature | Microsoft | Google |
|---------|-----------|--------|
| **User Types Filtered** | Guest users, Disabled users | Suspended users, Archived users |
| **API Fields** | `userType`, `accountEnabled` | `suspended`, `archived` |
| **Environment Variables** | `MICROSOFT_INCLUDE_GUESTS`, `MICROSOFT_INCLUDE_DISABLED` | `GOOGLE_INCLUDE_SUSPENDED`, `GOOGLE_INCLUDE_ARCHIVED` |
| **Default Behavior** | Exclude guests and disabled | Exclude suspended and archived |
| **API Query Support** | Full query support | Partial (suspended only) |
| **Cleanup Script** | `/api/admin/cleanup-guest-disabled-users` | `/api/admin/cleanup-google-suspended-archived-users` |

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Check Google Workspace credentials are valid
   - Verify refresh tokens haven't expired
   - Ensure proper OAuth scopes

2. **Rate Limiting**
   - Built-in rate limiter handles Google API limits
   - 1-minute delay between organizations
   - Exponential backoff for quota errors

3. **User Type Detection**
   - Verify `suspended` and `archived` fields in API response
   - Check user breakdown logs for unexpected user types
   - Monitor for API changes in user object structure

4. **Database Errors**
   - Check Supabase connection
   - Verify table permissions
   - Monitor for constraint violations

5. **Upstash Scheduling Issues**
   - Verify cron expression syntax
   - Check authentication headers
   - Monitor QStash logs for both providers

### Debug Mode
Enable detailed logging by checking the console output during execution. All operations are logged with prefixes:
- `🏢` Organization processing
- `🔍` Data fetching
- `📊` Statistics and counts
- `✅` Successful operations
- `❌` Errors and failures
- `🗑️` Removal operations

## Use Cases

### 1. Standard Organizations (Recommended)
```bash
# Default settings - only active organization members
GOOGLE_INCLUDE_SUSPENDED=false
GOOGLE_INCLUDE_ARCHIVED=false
```
**Result**: Clean user list with only active employees

### 2. Temporary Suspension Management
```bash
# Include suspended users but exclude archived
GOOGLE_INCLUDE_SUSPENDED=true
GOOGLE_INCLUDE_ARCHIVED=false
```
**Result**: Employees + temporarily suspended users (but not archived)

### 3. Full Audit Mode
```bash
# Include all users for comprehensive audit
GOOGLE_INCLUDE_SUSPENDED=true
GOOGLE_INCLUDE_ARCHIVED=true
```
**Result**: Complete user landscape including suspended and archived accounts

## Security Considerations

- Uses environment variables for sensitive credentials
- Authenticated endpoints with CRON_SECRET
- No email notifications to prevent spam
- Comprehensive logging for audit trails
- Dry run mode for safe testing
- Built-in rate limiting to respect Google API quotas

## Future Enhancements

### Planned Features
1. **UI Toggle**: Allow users to switch between filtered/unfiltered views
2. **Custom Filters**: More granular filtering options (by OU, role, etc.)
3. **User Type Analytics**: Dashboard showing user type breakdown
4. **Smart Detection**: Automatically identify service accounts vs. regular users

### Advanced Filtering
```typescript
// Future implementation
interface GoogleUserFilterOptions {
  includeSuspended: boolean;
  includeArchived: boolean;
  includeOrgUnits?: string[];
  excludeServiceAccounts?: boolean;
  minimumLastLoginTime?: Date;
}
```

---

**Status**: ✅ Implemented  
**Default Behavior**: Exclude suspended and archived users  
**Configuration**: Environment variables  
**Impact**: Reduces user counts to show only active organization members  
**Client Benefit**: More accurate usage reporting and insights  
**Cron Schedule**: Combined with Microsoft cleanup every Monday at 12 AM UTC
