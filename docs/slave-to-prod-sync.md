# Slave-to-Prod Sync System

This document describes the automated synchronization system that syncs data from the slave database to the main production database every 6 hours using QStash.

## Overview

The system consists of:
1. **Sync Endpoint**: `/api/background/sync/slave-to-prod` - Executes the actual sync operation
2. **Schedule Management**: `/api/background/sync/schedule` - Manages QStash schedules
3. **QStash Integration**: Handles recurring job scheduling and execution
4. **Setup Script**: Automated setup and configuration

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   QStash        │───▶│  Sync Endpoint  │───▶│ Database Sync   │
│   (Scheduler)   │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        │                        │                        ▼
        │                        │              ┌─────────────────┐
        │                        │              │ Slave Database  │
        │                        │              │ (Source)        │
        │                        │              └─────────────────┘
        │                        │                        │
        │                        │                        ▼
        │              ┌─────────────────┐                │
        │              │ Schedule Mgmt   │                │
        │              │ Endpoint        │                │
        │              └─────────────────┘                │
        │                                                 ▼
        │                                       ┌─────────────────┐
        │                                       │ Main Prod DB    │
        └───────────────────────────────────────│ (Destination)   │
                                                └─────────────────┘
```

## Environment Variables

Add these to your `.env.local` file:

```bash
# QStash Configuration
QSTASH_URL="https://qstash.upstash.io"
QSTASH_TOKEN="your-qstash-token"
QSTASH_CURRENT_SIGNING_KEY="your-current-signing-key"
QSTASH_NEXT_SIGNING_KEY="your-next-signing-key"

# App URL (for QStash callbacks)
NEXT_PUBLIC_APP_URL="https://your-app-domain.vercel.app"

# Database Configuration (existing)
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

## Setup Instructions

### 1. Quick Setup (Recommended)

Run the automated setup script:

```bash
npm run setup-slave-sync
```

This will:
- Validate environment variables
- Create the recurring sync schedule
- Test the manual sync trigger
- Provide management instructions

### 2. Manual Setup

If you prefer manual setup:

1. **Create the schedule:**
```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "create"}'
```

2. **Save the returned Schedule ID** for future management.

## API Endpoints

### Sync Endpoint: `/api/background/sync/slave-to-prod`

**POST** - Executes the sync operation

**Headers:**
- `upstash-signature`: QStash signature (for scheduled calls)
- `x-manual-trigger`: Set to "true" for manual triggers

**Response:**
```json
{
  "success": true,
  "message": "Slave-to-prod sync completed successfully",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "scheduled", // or "manual"
  "statistics": {
    "total_records": 1500,
    "sync_completed_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**GET** - Manual sync trigger (for testing)

### Schedule Management: `/api/background/sync/schedule`

**POST** - Manage schedules

**Actions:**
- `create` - Create new sync schedule
- `delete` - Delete a schedule
- `pause` - Pause a schedule
- `resume` - Resume a schedule
- `trigger-manual` - Trigger immediate sync

**Examples:**

```bash
# Create schedule
curl -X POST /api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "create"}'

# Pause schedule
curl -X POST /api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "pause", "scheduleId": "your-schedule-id"}'

# Trigger manual sync
curl -X POST /api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "trigger-manual"}'
```

**GET** - List all sync schedules

## Schedule Details

- **Frequency**: Every 6 hours
- **Cron Expression**: `0 */6 * * *`
- **Timezone**: UTC
- **Retries**: 2 attempts on failure
- **Timeout**: 30 seconds per attempt

## Sync Process

The sync operation performs these steps:

1. **Insert New Records**: Adds records from slave DB that don't exist in main DB
2. **Update Existing Records**: Updates all fields for records that exist in both databases
3. **Statistics Collection**: Counts total records and logs completion time

### SQL Operations

The sync uses two main operations based on `slave_db_to_main_prod.sql`:

1. **INSERT**: New records from slave to main
2. **UPDATE**: Existing records with latest data from slave

## Monitoring and Logging

### Application Logs

Check your application logs for sync status:

```
🔄 Starting slave-to-prod sync process...
📊 Sync type: Scheduled
📥 Step 1: Inserting new records from slave database...
✅ New records inserted successfully
🔄 Step 2: Updating existing records...
✅ Existing records updated successfully
🎉 Sync completed: {...}
```

### QStash Dashboard

Monitor schedules in the QStash dashboard:
- https://console.upstash.com/qstash

### Error Handling

Failed syncs will:
1. Log detailed error messages
2. Return error response with details
3. Retry automatically (up to 2 times)
4. Send failure notifications to QStash

## Management Commands

### List Active Schedules
```bash
curl -X GET https://your-app-domain.vercel.app/api/background/sync/schedule
```

### Pause Sync (Maintenance)
```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "pause", "scheduleId": "YOUR_SCHEDULE_ID"}'
```

### Resume Sync
```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "resume", "scheduleId": "YOUR_SCHEDULE_ID"}'
```

### Manual Sync (Testing)
```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "trigger-manual"}'
```

### Delete Schedule
```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "delete", "scheduleId": "YOUR_SCHEDULE_ID"}'
```

## Troubleshooting

### Common Issues

1. **Environment Variables Missing**
   - Ensure all QStash variables are set
   - Check `.env.local` file

2. **Schedule Not Running**
   - Verify schedule is active (not paused)
   - Check QStash dashboard for errors
   - Ensure app URL is accessible

3. **Database Connection Issues**
   - Verify Supabase credentials
   - Check database schema access
   - Ensure service role permissions

4. **Sync Failures**
   - Check application logs for detailed errors
   - Verify source database accessibility
   - Test manual sync for debugging

### Debug Mode

For debugging, trigger a manual sync and check logs:

```bash
# Trigger manual sync
curl -X GET https://your-app-domain.vercel.app/api/background/sync/slave-to-prod
```

### Health Check

Test the sync endpoint directly:

```bash
curl -X POST https://your-app-domain.vercel.app/api/background/sync/slave-to-prod \
  -H "x-manual-trigger: true"
```

## Security

- QStash signature verification protects against unauthorized calls
- Service role keys provide database access control
- HTTPS enforced for all communications
- Environment variables protect sensitive credentials

## Performance

- Sync typically completes in 30-60 seconds
- Resource usage monitored and logged
- Automatic retries prevent data inconsistencies
- Non-blocking operation doesn't affect app performance

## Support

For issues:
1. Check application logs first
2. Verify environment configuration
3. Test manual sync for immediate debugging
4. Review QStash dashboard for schedule status 