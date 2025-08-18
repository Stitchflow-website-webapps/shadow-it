# Quick Setup: Slave-to-Prod Sync

## 🚀 Quick Start

1. **Add environment variables to your `.env.local`:**
```bash


2. **Run the setup script:**
```bash
npm run setup-slave-sync
```

3. **Save the Schedule ID** returned by the script for future management.

## 📋 What's Included

✅ **API Endpoints:**
- `/api/background/sync/slave-to-prod` - Executes sync
- `/api/background/sync/schedule` - Manages schedules

✅ **QStash Integration:**
- Automatic scheduling every 6 hours
- Retry logic (2 attempts)
- Signature verification

✅ **Management Tools:**
- Setup script
- Schedule management
- Manual sync triggers

✅ **Documentation:**
- Full docs in `docs/slave-to-prod-sync.md`
- API examples and troubleshooting

## ⚡ Quick Commands

```bash
# Manual sync test
curl -X GET https://your-app-domain.vercel.app/api/background/sync/slave-to-prod

# List schedules
curl -X GET https://your-app-domain.vercel.app/api/background/sync/schedule

# Trigger manual sync
curl -X POST https://your-app-domain.vercel.app/api/background/sync/schedule \
  -H "Content-Type: application/json" \
  -d '{"action": "trigger-manual"}'
```

## 🔍 Monitoring

- Check application logs for sync status
- Monitor QStash dashboard: https://console.upstash.com/qstash
- Sync runs every 6 hours automatically

## 📚 Full Documentation

See `docs/slave-to-prod-sync.md` for complete documentation including:
- Architecture overview
- Detailed API reference
- Troubleshooting guide
- Security considerations 