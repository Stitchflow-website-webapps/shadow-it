# 🧪 Spoton Sync Test Guide

## Overview
This guide helps you test the optimized sync process using Spoton's organization data (2K+ members) to validate:
- ✅ CPU optimization (1 CPU + 2GB RAM)
- ✅ Token refresh functionality  
- ✅ Memory management
- ✅ No email spam during testing

## 🎯 Test Objectives

### What We're Testing:
1. **CPU Optimization**: Verify PROCESSING_CONFIG prevents CPU maxing out
2. **Token Refresh**: Ensure Google/Microsoft tokens refresh properly
3. **Memory Management**: Monitor memory usage stays under 2GB
4. **Large Organization**: Test with Spoton's ~2000 members
5. **Error Handling**: Verify graceful failure handling

### What We're NOT Testing:
- ❌ Email notifications (disabled in test mode)
- ❌ Production user impact (isolated test)
- ❌ Multiple organizations (Spoton only)

## 🚀 Deployment Steps

### 1. Deploy to Render
```bash
# Push your changes to your main branch
git add .
git commit -m "Add Spoton sync test with CPU optimization"
git push origin main

# Render will auto-deploy from your connected repository
```

### 2. Verify Environment Variables
Ensure these are set in Render:
```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_redirect_uri
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

## 🧪 Running the Test

### Method 1: Using the Test Script (Recommended)
```bash
# From your local machine
node scripts/test-spoton-sync.js https://your-render-app.onrender.com
```

### Method 2: Direct API Call
```bash
curl -X POST https://your-render-app.onrender.com/api/background/test-spoton-sync \
  -H "Content-Type: application/json"
```

### Method 3: Browser/Postman
- **URL**: `https://your-render-app.onrender.com/api/background/test-spoton-sync`
- **Method**: POST
- **Headers**: `Content-Type: application/json`

## 📊 Monitoring the Test

### 1. Real-time Logs (Render Dashboard)
- Go to your Render service dashboard
- Click "Logs" tab
- Watch for test progress indicators:
  ```
  🧪 [TEST] Starting Spoton sync test...
  🔍 [TEST] Fetching Spoton tokens from database...
  ✅ [TEST] Found Spoton tokens, creating test sync record...
  📊 [TEST] Starting memory usage: 45MB heap, 128MB RSS
  🚀 [TEST] Triggering main sync endpoint...
  ```

### 2. Database Monitoring
Check the `sync_status` table for progress:
```sql
SELECT id, status, progress, message, created_at, updated_at 
FROM sync_status 
WHERE organization_id = 'a3b83096-3df8-48bf-a0b1-094d9d160769b'
ORDER BY created_at DESC 
LIMIT 5;
```

### 3. Expected Timeline
- **Small orgs (< 100 users)**: 2-5 minutes
- **Medium orgs (100-1000 users)**: 5-15 minutes  
- **Large orgs (1000-5000 users)**: 10-30 minutes
- **Spoton (~2000 users)**: 15-25 minutes

## ✅ Success Indicators

### 1. API Response
```json
{
  "success": true,
  "message": "🧪 Spoton sync test completed successfully",
  "syncId": "uuid-here",
  "organizationId": "a3b83096-3df8-48bf-a0b1-094d9d160769b",
  "finalStatus": {
    "status": "COMPLETED",
    "progress": 100,
    "message": "🧪 TEST: google data sync completed"
  },
  "memoryUsage": {
    "start": { "heapUsed": "45MB", "rss": "128MB" },
    "end": { "heapUsed": "180MB", "rss": "256MB" },
    "increase": "135MB"
  },
  "testNotes": [
    "✅ Used optimized PROCESSING_CONFIG for 1 CPU + 2GB RAM",
    "✅ Token refresh functionality tested",
    "✅ Email notifications skipped (test mode)",
    "✅ Memory usage monitored",
    "✅ CPU optimization applied"
  ]
}
```

### 2. Database Results
- New applications discovered and saved
- User-application relationships created
- Sync status shows "COMPLETED"
- No "FAILED" status

### 3. System Health
- CPU usage stays reasonable (not maxed out)
- Memory usage under 2GB
- No service crashes or timeouts

## ❌ Failure Scenarios & Troubleshooting

### 1. Token Refresh Failures
**Symptoms**: `401 Unauthorized` or `invalid_grant` errors
**Solution**: Check if tokens in database are still valid

### 2. Memory Issues
**Symptoms**: Service crashes, out of memory errors
**Solution**: Reduce batch sizes in PROCESSING_CONFIG

### 3. CPU Maxing Out
**Symptoms**: Service becomes unresponsive, high CPU usage
**Solution**: Increase delays between operations

### 4. Database Connection Issues
**Symptoms**: Connection timeout errors
**Solution**: Check Supabase service status and connection limits

## 🔧 Configuration Tuning

If the test reveals issues, adjust these settings:

### For Memory Issues:
```typescript
const PROCESSING_CONFIG = {
  BATCH_SIZE: 15,           // Reduce from 25
  MAX_TOKENS_PER_BATCH: 50, // Reduce from 75
  MEMORY_CLEANUP_INTERVAL: 75, // Reduce from 150
};
```

### For CPU Issues:
```typescript
const PROCESSING_CONFIG = {
  DELAY_BETWEEN_BATCHES: 200,  // Increase from 100ms
  DB_OPERATION_DELAY: 100,     // Increase from 50ms
};
```

## 📈 Performance Benchmarks

### Target Performance (1 CPU + 2GB RAM):
- **Memory**: Peak usage < 1.5GB
- **CPU**: Average usage < 80%
- **Time**: 15-25 minutes for Spoton
- **Success Rate**: 100% completion

### Red Flags:
- Memory usage > 1.8GB
- CPU usage > 95% for extended periods
- Sync time > 45 minutes
- Any service crashes or timeouts

## 🧹 Cleanup After Testing

The test endpoint automatically:
- ✅ Creates isolated sync records
- ✅ Skips email notifications
- ✅ Uses test mode flags
- ✅ Provides detailed logging

No manual cleanup required - test data will be in the database but won't affect production users.

## 📞 Next Steps After Successful Test

1. **Monitor Production**: Deploy to production with confidence
2. **Set Up Alerts**: Monitor CPU/memory usage in production
3. **Scale Planning**: Document performance characteristics for scaling decisions
4. **Documentation**: Update performance docs with real-world results 