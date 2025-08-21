# Weekly Microsoft Guest/Disabled Users Cleanup System

## Overview

This system automatically removes guest users and disabled users from Microsoft organizations in your database every Monday at 12 AM. It also cleans up their associated user-application relationships and removes applications that become empty as a result.

## Components

### 1. Main Cleanup Script
**File**: `app/api/admin/cleanup-guest-disabled-users/route.ts`

**Purpose**: Processes Microsoft organizations to remove guest/disabled users and their relationships.

**Features**:
- Fetches guest users and disabled users from Microsoft Graph API
- Removes these users from the database
- Removes their user-application relationships
- Removes applications that become empty after cleanup
- Supports dry run mode for testing
- Retry logic for failed organizations (up to 2 retries)
- Comprehensive logging

### 2. Weekly Cron Endpoint
**File**: `app/api/cron/weekly-microsoft-cleanup/route.ts`

**Purpose**: Scheduled endpoint for Upstash to trigger weekly cleanup.

**Features**:
- Authenticated with CRON_SECRET or Upstash signature
- Calls main cleanup script for all Microsoft orgs
- Supports both POST (live) and GET (dry run) methods
- Returns summary statistics

## Setup Instructions

### 1. Environment Variables
Make sure these are set in your environment:
```bash
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
CRON_SECRET=your_cron_secret_key
```

### 2. Upstash Cron Job Setup
1. Go to [Upstash Console](https://console.upstash.com/)
2. Navigate to QStash → Schedules
3. Create a new schedule with:
   - **Name**: `weekly-microsoft-cleanup`
   - **Destination**: `https://your-domain.com/api/cron/weekly-microsoft-cleanup`
   - **Cron Expression**: `0 0 * * 1` (Every Monday at 12:00 AM UTC)
   - **Method**: `POST`
   - **Headers**: 
     - `Authorization: Bearer your_cron_secret_key`
     - `Content-Type: application/json`

## Usage

### Manual Testing (Dry Run)
Test the system without making changes:

```bash
# Test specific organization
curl -X POST https://your-domain.com/api/admin/cleanup-guest-disabled-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true,
    "organization_id": "specific-org-id"
  }'

# Test all organizations
curl -X POST https://your-domain.com/api/admin/cleanup-guest-disabled-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": true
  }'
```

### Manual Testing (Cron Endpoint)
Test the weekly cron endpoint:

```bash
# Dry run test
curl -X GET https://your-domain.com/api/cron/weekly-microsoft-cleanup \
  -H "Authorization: Bearer your_cron_secret"

# Live run test (be careful!)
curl -X POST https://your-domain.com/api/cron/weekly-microsoft-cleanup \
  -H "Authorization: Bearer your_cron_secret"
```

### Live Execution
Run actual cleanup (removes data):

```bash
# Specific organization
curl -X POST https://your-domain.com/api/admin/cleanup-guest-disabled-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": false,
    "organization_id": "specific-org-id"
  }'

# All organizations
curl -X POST https://your-domain.com/api/admin/cleanup-guest-disabled-users \
  -H "Content-Type: application/json" \
  -d '{
    "dry_run": false
  }'
```

## What Gets Cleaned Up

### 1. Users Removed
- **Guest Users**: Users with `userType = 'Guest'`
- **Disabled Users**: Users with `accountEnabled = false`

### 2. Relationships Removed
- All `user_applications` records for removed users

### 3. Applications Removed
- Applications that have **zero users** after cleanup
- Only applications that become empty due to this cleanup process
- Does not remove pre-existing empty applications

## Process Flow

1. **Fetch Organizations**: Get all Microsoft organizations from database
2. **For Each Organization** (with 1-minute delay between orgs):
   - Get Microsoft credentials and initialize service
   - Fetch guest users and disabled users from Microsoft Graph API
   - Find these users in our database
   - Remove their `user_applications` relationships
   - Remove the users from `users` table
   - Check for applications that became empty
   - Remove empty applications
   - Retry up to 2 times if errors occur
   - Log all actions taken

## Error Handling

### Retry Logic
- Each organization gets up to 2 retry attempts
- 5-second delay between retry attempts
- If all retries fail, moves to next organization
- Failed organizations are logged with error details

### Timeout Protection
- Main cleanup script: 1 hour timeout
- Individual organization processing continues even if one fails
- Comprehensive error logging for debugging

## Response Format

### Success Response
```json
{
  "success": true,
  "dryRun": false,
  "summary": {
    "totalOrganizations": 5,
    "successfulOrganizations": 4,
    "failedOrganizations": 1,
    "totalRemovedUsers": 25,
    "totalRemovedRelationships": 150,
    "totalRemovedApplications": 3,
    "totalGuestUsers": 20,
    "totalDisabledUsers": 5
  },
  "results": [
    {
      "organizationId": "org-123",
      "organizationName": "Example Corp",
      "organizationDomain": "example.com",
      "success": true,
      "removedUsers": 5,
      "removedRelationships": 30,
      "removedApplications": 1,
      "guestUsers": 4,
      "disabledUsers": 1,
      "retryCount": 0,
      "details": {
        "removedUserEmails": ["guest1@external.com", "disabled@example.com"],
        "removedApplicationNames": ["Unused App"],
        "relationshipsByApp": {
          "Slack": 15,
          "Unused App": 15
        }
      }
    }
  ]
}
```

### Error Response
```json
{
  "success": false,
  "error": "Cleanup process failed",
  "details": "Specific error message"
}
```

## Monitoring

### Logs to Monitor
- Organization processing progress
- User and relationship removal counts
- Application removal decisions
- Retry attempts and failures
- Microsoft Graph API calls

### Key Metrics
- Total organizations processed
- Success/failure rates
- Users removed (guest vs disabled)
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
- Processes all Microsoft orgs if no specific org provided

### Conservative Application Removal
- Only removes applications that become empty due to this cleanup
- Does not touch pre-existing empty applications
- Prevents accidental removal of legitimate empty apps

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Check Microsoft credentials are valid
   - Verify refresh tokens haven't expired
   - Ensure proper tenant ID extraction

2. **Rate Limiting**
   - 1-minute delay between organizations
   - Built-in retry logic with delays
   - Monitor Microsoft Graph API limits

3. **Database Errors**
   - Check Supabase connection
   - Verify table permissions
   - Monitor for constraint violations

4. **Upstash Scheduling Issues**
   - Verify cron expression syntax
   - Check authentication headers
   - Monitor QStash logs

### Debug Mode
Enable detailed logging by checking the console output during execution. All operations are logged with prefixes:
- `🏢` Organization processing
- `🔍` Data fetching
- `📊` Statistics and counts
- `✅` Successful operations
- `❌` Errors and failures
- `🗑️` Removal operations

## Security Considerations

- Uses environment variables for sensitive credentials
- Authenticated endpoints with CRON_SECRET
- No email notifications to prevent spam
- Comprehensive logging for audit trails
- Dry run mode for safe testing

---

**Created**: January 2025  
**Last Updated**: January 2025  
**Status**: ✅ Implemented and Ready for Production
