#!/bin/bash

# Cron Job Setup Script for Supabase Backups
# This script helps you set up automated daily backups

set -e

echo "⏰ Setting up Cron Job for Supabase Backups"
echo "==========================================="

# Get the current directory (where the script is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_SCRIPT="$PROJECT_DIR/scripts/supabase-backup-to-gcs.js"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/backup.log"

echo "📁 Project directory: $PROJECT_DIR"
echo "📄 Backup script: $BACKUP_SCRIPT"
echo "📋 Log file: $LOG_FILE"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to prompt for input
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local default_value="$3"
    
    if [ -n "$default_value" ]; then
        read -p "$prompt [$default_value]: " input
        eval "$var_name=\"\${input:-$default_value}\""
    else
        read -p "$prompt: " input
        eval "$var_name=\"$input\""
    fi
}

# Get user preferences
echo ""
echo "📝 Backup Schedule Configuration:"
echo ""

echo "Choose backup frequency:"
echo "1) Daily at 2:00 AM (recommended)"
echo "2) Daily at custom time"
echo "3) Twice daily (2:00 AM and 2:00 PM)"
echo "4) Custom cron expression"
echo ""

read -p "Select option (1-4): " frequency_option

case $frequency_option in
    1)
        CRON_SCHEDULE="0 2 * * *"
        DESCRIPTION="Daily at 2:00 AM"
        ;;
    2)
        prompt_input "Enter hour (0-23)" backup_hour "2"
        prompt_input "Enter minute (0-59)" backup_minute "0"
        CRON_SCHEDULE="$backup_minute $backup_hour * * *"
        DESCRIPTION="Daily at $backup_hour:$(printf "%02d" $backup_minute)"
        ;;
    3)
        CRON_SCHEDULE="0 2,14 * * *"
        DESCRIPTION="Twice daily at 2:00 AM and 2:00 PM"
        ;;
    4)
        prompt_input "Enter custom cron expression" CRON_SCHEDULE
        DESCRIPTION="Custom schedule: $CRON_SCHEDULE"
        ;;
    *)
        echo "Invalid option. Using default: Daily at 2:00 AM"
        CRON_SCHEDULE="0 2 * * *"
        DESCRIPTION="Daily at 2:00 AM"
        ;;
esac

echo ""
echo "Configuration Summary:"
echo "  Schedule: $DESCRIPTION"
echo "  Cron Expression: $CRON_SCHEDULE"
echo "  Script: $BACKUP_SCRIPT"
echo "  Logs: $LOG_FILE"
echo ""

read -p "Continue with cron job setup? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Setup cancelled."
    exit 0
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check if the backup script exists
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "❌ Backup script not found: $BACKUP_SCRIPT"
    exit 1
fi

# Create the cron job entry
CRON_COMMAND="cd $PROJECT_DIR && /usr/bin/env node $BACKUP_SCRIPT >> $LOG_FILE 2>&1"
CRON_ENTRY="$CRON_SCHEDULE $CRON_COMMAND"

echo "🔧 Setting up cron job..."

# Backup existing crontab
echo "📋 Backing up existing crontab..."
crontab -l > /tmp/crontab_backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "No existing crontab found"

# Check if our backup job already exists
if crontab -l 2>/dev/null | grep -q "supabase-backup-to-gcs.js"; then
    echo "⚠️  Existing Supabase backup cron job found. Removing it..."
    crontab -l 2>/dev/null | grep -v "supabase-backup-to-gcs.js" | crontab -
fi

# Add the new cron job
echo "➕ Adding new cron job..."
(crontab -l 2>/dev/null; echo "# Supabase Database Backup - $DESCRIPTION"; echo "$CRON_ENTRY") | crontab -

echo "✅ Cron job added successfully!"

# Create log rotation script
echo "📄 Setting up log rotation..."
cat > "$PROJECT_DIR/scripts/rotate-backup-logs.sh" << 'EOF'
#!/bin/bash
# Log rotation script for Supabase backups

LOG_FILE="$(dirname "$0")/../logs/backup.log"
MAX_SIZE=10485760  # 10MB in bytes

if [ -f "$LOG_FILE" ]; then
    if [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null) -gt $MAX_SIZE ]; then
        mv "$LOG_FILE" "${LOG_FILE}.old"
        touch "$LOG_FILE"
        echo "$(date): Log rotated" >> "$LOG_FILE"
    fi
fi
EOF

chmod +x "$PROJECT_DIR/scripts/rotate-backup-logs.sh"

# Add log rotation to cron (weekly)
LOG_ROTATION_CRON="0 3 * * 0 $PROJECT_DIR/scripts/rotate-backup-logs.sh"
(crontab -l 2>/dev/null; echo "# Backup log rotation - Weekly on Sunday at 3:00 AM"; echo "$LOG_ROTATION_CRON") | crontab -

echo "✅ Log rotation configured"

# Create monitoring script
echo "📊 Creating backup monitoring script..."
cat > "$PROJECT_DIR/scripts/check-backup-status.sh" << 'EOF'
#!/bin/bash
# Backup status monitoring script

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/logs/backup.log"
ENV_FILE="$PROJECT_DIR/.env.backup"

# Source environment variables
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

echo "🔍 Supabase Backup Status Check"
echo "==============================="
echo "Time: $(date)"
echo ""

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    echo "❌ No backup log file found"
    exit 1
fi

# Get last backup info
echo "📋 Last 5 backup attempts:"
tail -n 50 "$LOG_FILE" | grep -E "(Starting Supabase backup|Backup completed|Backup failed)" | tail -n 5

echo ""

# Check for recent successful backup (within last 25 hours)
LAST_SUCCESS=$(grep "Backup completed successfully" "$LOG_FILE" | tail -n 1 | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}')

if [ -n "$LAST_SUCCESS" ]; then
    LAST_SUCCESS_TIMESTAMP=$(date -d "$LAST_SUCCESS" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$LAST_SUCCESS" +%s 2>/dev/null)
    CURRENT_TIMESTAMP=$(date +%s)
    HOURS_SINCE=$(( (CURRENT_TIMESTAMP - LAST_SUCCESS_TIMESTAMP) / 3600 ))
    
    echo "✅ Last successful backup: $LAST_SUCCESS ($HOURS_SINCE hours ago)"
    
    if [ $HOURS_SINCE -gt 25 ]; then
        echo "⚠️  Warning: Last successful backup was more than 25 hours ago"
    fi
else
    echo "❌ No successful backups found in log"
fi

# Check for recent failures
RECENT_FAILURES=$(tail -n 100 "$LOG_FILE" | grep "Backup failed" | wc -l)
if [ $RECENT_FAILURES -gt 0 ]; then
    echo "⚠️  Found $RECENT_FAILURES recent backup failures"
    echo "Last failure:"
    tail -n 100 "$LOG_FILE" | grep "Backup failed" | tail -n 1
fi

# Check GCS bucket if configured
if [ -n "$GCS_BACKUP_BUCKET" ] && command -v gsutil &> /dev/null; then
    echo ""
    echo "☁️  Checking GCS bucket..."
    BACKUP_COUNT=$(gsutil ls "gs://$GCS_BACKUP_BUCKET/backups/" 2>/dev/null | wc -l || echo "0")
    echo "Total backups in GCS: $BACKUP_COUNT"
    
    if [ $BACKUP_COUNT -gt 0 ]; then
        echo "Most recent backup:"
        gsutil ls -l "gs://$GCS_BACKUP_BUCKET/backups/" | tail -n 1
    fi
fi

echo ""
echo "📊 Log file size: $(du -h "$LOG_FILE" | cut -f1)"
echo "💾 Disk usage in logs directory: $(du -sh "$(dirname "$LOG_FILE")" | cut -f1)"
EOF

chmod +x "$PROJECT_DIR/scripts/check-backup-status.sh"

echo "✅ Monitoring script created"

# Display final information
echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "📋 Summary:"
echo "  ✓ Cron job scheduled: $DESCRIPTION"
echo "  ✓ Log rotation configured (weekly)"
echo "  ✓ Monitoring script created"
echo ""
echo "📁 Files created:"
echo "  • $PROJECT_DIR/scripts/rotate-backup-logs.sh"
echo "  • $PROJECT_DIR/scripts/check-backup-status.sh"
echo ""
echo "🔧 Management commands:"
echo "  View cron jobs:     crontab -l"
echo "  Edit cron jobs:     crontab -e"
echo "  View backup logs:   tail -f $LOG_FILE"
echo "  Check status:       $PROJECT_DIR/scripts/check-backup-status.sh"
echo "  Test backup:        cd $PROJECT_DIR && node scripts/supabase-backup-to-gcs.js"
echo ""
echo "⚠️  Important reminders:"
echo "  1. Make sure .env.backup is configured with your Supabase credentials"
echo "  2. Test the backup script manually before relying on the cron job"
echo "  3. Monitor the logs regularly, especially in the first few days"
echo "  4. Set up alerting if you need immediate notification of failures"
echo ""
echo "🎯 Next steps:"
echo "  1. Configure .env.backup with your credentials"
echo "  2. Run a test backup: cd $PROJECT_DIR && node scripts/supabase-backup-to-gcs.js"
echo "  3. Wait for the first scheduled backup and check the logs"\
echo "  4. Set up monitoring alerts if needed"
