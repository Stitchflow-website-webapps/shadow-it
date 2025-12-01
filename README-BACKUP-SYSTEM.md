# Supabase Automated Backup System

This system provides automated daily backups of your Supabase database to Google Cloud Storage, following Supabase's recommended backup practices.

## 🚀 Quick Start

### 1. Prerequisites

Install required tools:
```bash
# Install Supabase CLI
npm install -g supabase

# Install Google Cloud SDK
# Visit: https://cloud.google.com/sdk/docs/install

# Install Node.js dependencies
npm install @google-cloud/storage
```

### 2. Setup Google Cloud Storage

Run the automated setup script:
```bash
chmod +x scripts/setup-gcs-backup.sh
./scripts/setup-gcs-backup.sh
```

This will:
- Create a GCS bucket for backups
- Set up a service account with proper permissions
- Generate authentication keys
- Create environment configuration

### 3. Configure Environment

Edit `.env.backup` with your Supabase credentials:
```bash
# Supabase Database Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_DB_PASSWORD=your-database-password
SUPABASE_PROJECT_REF=your-project-ref

# GCS Configuration (auto-filled by setup script)
GCS_PROJECT_ID=your-gcp-project-id
GCS_BACKUP_BUCKET=your-backup-bucket-name
GCS_KEY_FILE_PATH=./gcp-service-account-key.json
```

### 4. Test the Backup

Run a manual backup to verify everything works:
```bash
node scripts/supabase-backup-to-gcs.js
```

### 5. Setup Automated Backups

Configure daily automated backups:
```bash
chmod +x scripts/setup-backup-cron.sh
./scripts/setup-backup-cron.sh
```

## 📁 System Components

### Core Scripts

- **`supabase-backup-to-gcs.js`** - Main backup script
- **`restore-from-gcs-backup.js`** - Database restoration script
- **`backup-monitoring.js`** - Monitoring and alerting system

### Setup Scripts

- **`setup-gcs-backup.sh`** - GCS bucket and service account setup
- **`setup-backup-cron.sh`** - Automated cron job configuration

### Monitoring Scripts

- **`check-backup-status.sh`** - Manual backup status check
- **`rotate-backup-logs.sh`** - Log rotation (auto-configured)

## 🔧 Configuration Options

### Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_DB_PASSWORD=your-db-password
SUPABASE_PROJECT_REF=your-project-ref
GCS_PROJECT_ID=your-gcp-project
GCS_BACKUP_BUCKET=your-backup-bucket
GCS_KEY_FILE_PATH=./gcp-service-account-key.json

# Optional
BACKUP_RETENTION_DAYS=30
BACKUP_NOTIFICATION_WEBHOOK=https://hooks.slack.com/...
MAX_HOURS_SINCE_BACKUP=25
MIN_BACKUP_SIZE_MB=1
ALERT_COOLDOWN_HOURS=4
```

### Backup Schedule Options

The setup script offers several scheduling options:
- Daily at 2:00 AM (recommended)
- Daily at custom time
- Twice daily (2:00 AM and 2:00 PM)
- Custom cron expression

## 📊 Monitoring and Alerts

### Automatic Monitoring

The system includes comprehensive monitoring:
- ✅ Backup success/failure detection
- ⏰ Overdue backup alerts
- 📊 Backup size validation
- ☁️ GCS bucket health checks
- 🔄 Consecutive failure tracking

### Notification Channels

Configure webhooks for alerts:
- Slack
- Discord
- Microsoft Teams
- Custom webhooks

### Manual Status Checks

```bash
# Check backup status
./scripts/check-backup-status.sh

# View recent logs
tail -f logs/backup.log

# Run monitoring check
node scripts/backup-monitoring.js
```

## 🔄 Backup Process

The system creates three separate backup files following Supabase's recommendations:

1. **`roles.sql`** - Database roles and permissions
2. **`schema.sql`** - Database structure (tables, functions, etc.)
3. **`data.sql`** - All data using COPY format for efficiency
4. **`manifest.json`** - Backup metadata and restoration instructions

### Backup Storage Structure

```
gs://your-backup-bucket/
└── backups/
    ├── 2024-01-15T02-00-00-000Z/
    │   ├── roles.sql
    │   ├── schema.sql
    │   ├── data.sql
    │   └── manifest.json
    ├── 2024-01-16T02-00-00-000Z/
    │   └── ...
    └── ...
```

## 🔄 Restoration Process

### Automatic Restoration

```bash
# Interactive restoration (lists available backups)
node scripts/restore-from-gcs-backup.js

# Restore specific backup
node scripts/restore-from-gcs-backup.js 2024-01-15T02-00-00-000Z
```

### Manual Restoration

If you need to restore manually:

```bash
# Download backup files from GCS
gsutil cp -r gs://your-backup-bucket/backups/TIMESTAMP ./restore/

# Restore using psql
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file restore/roles.sql \
  --file restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file restore/data.sql \
  --dbname "postgresql://postgres.PROJECT:PASSWORD@HOST:5432/postgres"
```

## 🛠️ Maintenance

### Log Management

Logs are automatically rotated weekly. Manual log management:

```bash
# View current log size
du -h logs/backup.log

# Manually rotate logs
./scripts/rotate-backup-logs.sh

# Clear old logs
rm logs/backup.log.old
```

### Backup Cleanup

Old backups are automatically cleaned up based on `BACKUP_RETENTION_DAYS` (default: 30 days).

### Cron Job Management

```bash
# View current cron jobs
crontab -l

# Edit cron jobs
crontab -e

# Remove backup cron jobs
crontab -l | grep -v "supabase-backup" | crontab -
```

## 🚨 Troubleshooting

### Common Issues

1. **"Supabase CLI not found"**
   ```bash
   npm install -g supabase
   ```

2. **"Cannot access GCS bucket"**
   - Verify service account key file exists
   - Check GCS permissions
   - Ensure bucket exists

3. **"Database connection failed"**
   - Verify Supabase credentials in `.env.backup`
   - Check database password
   - Ensure project reference is correct

4. **"Permission denied during restore"**
   - Edit schema.sql and comment out `ALTER ... OWNER TO "supabase_admin"` lines
   - Ensure target database has proper permissions

### Debug Mode

Run scripts with additional logging:
```bash
DEBUG=1 node scripts/supabase-backup-to-gcs.js
```

### Log Analysis

```bash
# Check for recent failures
grep "Backup failed" logs/backup.log | tail -5

# Check backup sizes
grep "Total backup size" logs/backup.log | tail -10

# Monitor real-time
tail -f logs/backup.log
```

## 🔐 Security Best Practices

1. **Protect Service Account Keys**
   - Never commit `gcp-service-account-key.json` to version control
   - Store keys securely in production environments
   - Rotate keys regularly

2. **Environment Variables**
   - Keep `.env.backup` secure
   - Use environment-specific configurations
   - Avoid hardcoding credentials

3. **Access Control**
   - Limit GCS bucket access to backup service account
   - Use least-privilege principles
   - Monitor access logs

4. **Network Security**
   - Use VPC endpoints for GCS access if possible
   - Implement firewall rules for database access
   - Consider private connectivity options

## 📈 Performance Optimization

### Large Databases

For databases > 10GB:
- Consider using `--jobs` parameter for parallel processing
- Increase `maxBuffer` in restore script
- Monitor disk space during backup/restore

### Network Optimization

- Use regional GCS buckets close to your Supabase region
- Consider compression for large backups
- Monitor transfer costs

## 🆘 Emergency Procedures

### Immediate Backup

```bash
# Create emergency backup now
node scripts/supabase-backup-to-gcs.js
```

### Quick Restore

```bash
# Restore latest backup (skip confirmations)
SKIP_CONFIRMATION=true node scripts/restore-from-gcs-backup.js
```

### Disaster Recovery

1. Identify last known good backup
2. Create new Supabase project if needed
3. Run restoration process
4. Verify data integrity
5. Update application configuration
6. Resume normal operations

## 📞 Support

For issues with this backup system:
1. Check the troubleshooting section
2. Review logs in `logs/backup.log`
3. Run monitoring script for health check
4. Verify GCS and Supabase connectivity

For Supabase-specific issues, refer to:
- [Supabase Backup Documentation](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Supabase Support](https://supabase.com/support)
