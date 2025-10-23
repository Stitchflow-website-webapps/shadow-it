#!/bin/bash

# Google Cloud Storage Setup Script for Supabase Backups
# This script helps you set up GCS bucket and service account for automated backups

set -e

echo "🚀 Setting up Google Cloud Storage for Supabase Backups"
echo "======================================================="

# Configuration
PROJECT_ID=""
BUCKET_NAME=""
SERVICE_ACCOUNT_NAME="supabase-backup-sa"
SERVICE_ACCOUNT_EMAIL=""
KEY_FILE_PATH="./gcp-service-account-key.json"

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

# Get user input
echo "📝 Please provide the following information:"
echo ""

prompt_input "Google Cloud Project ID" PROJECT_ID
prompt_input "Backup bucket name" BUCKET_NAME "supabase-backups-$(date +%Y%m%d)"
prompt_input "Service account name" SERVICE_ACCOUNT_NAME "supabase-backup-sa"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "Configuration Summary:"
echo "  Project ID: $PROJECT_ID"
echo "  Bucket Name: $BUCKET_NAME"
echo "  Service Account: $SERVICE_ACCOUNT_EMAIL"
echo ""

read -p "Continue with setup? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Setup cancelled."
    exit 0
fi

echo ""
echo "🔧 Setting up Google Cloud resources..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Google Cloud SDK not found. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set the project
echo "📋 Setting GCP project..."
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "🔌 Enabling required APIs..."
gcloud services enable storage.googleapis.com
gcloud services enable iam.googleapis.com

# Create the storage bucket
echo "🪣 Creating storage bucket..."
if gsutil ls -b "gs://$BUCKET_NAME" &> /dev/null; then
    echo "  ℹ️  Bucket $BUCKET_NAME already exists"
else
    # Create bucket with appropriate settings
    gsutil mb -p "$PROJECT_ID" -c STANDARD -l US "gs://$BUCKET_NAME"
    
    # Set lifecycle policy for automatic cleanup
    cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 90}
      }
    ]
  }
}
EOF
    
    gsutil lifecycle set lifecycle.json "gs://$BUCKET_NAME"
    rm lifecycle.json
    
    echo "  ✅ Bucket created with 90-day lifecycle policy"
fi

# Create service account
echo "👤 Creating service account..."
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" &> /dev/null; then
    echo "  ℹ️  Service account already exists"
else
    gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
        --display-name="Supabase Backup Service Account" \
        --description="Service account for automated Supabase database backups"
    echo "  ✅ Service account created"
fi

# Grant necessary permissions
echo "🔐 Granting permissions..."
gsutil iam ch "serviceAccount:$SERVICE_ACCOUNT_EMAIL:objectAdmin" "gs://$BUCKET_NAME"
gsutil iam ch "serviceAccount:$SERVICE_ACCOUNT_EMAIL:legacyBucketReader" "gs://$BUCKET_NAME"

# Create and download service account key
echo "🔑 Creating service account key..."
if [ -f "$KEY_FILE_PATH" ]; then
    echo "  ⚠️  Key file already exists. Creating backup..."
    mv "$KEY_FILE_PATH" "${KEY_FILE_PATH}.backup.$(date +%Y%m%d-%H%M%S)"
fi

gcloud iam service-accounts keys create "$KEY_FILE_PATH" \
    --iam-account="$SERVICE_ACCOUNT_EMAIL"

echo "  ✅ Service account key saved to $KEY_FILE_PATH"

# Set up environment file
echo "📄 Creating environment configuration..."
ENV_FILE=".env.backup"

cat > "$ENV_FILE" << EOF
# Supabase Backup Configuration
# Generated on $(date)

# Supabase Database Configuration (FILL THESE IN)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_DB_PASSWORD=your-database-password
SUPABASE_PROJECT_REF=your-project-ref

# Google Cloud Storage Configuration
GCS_PROJECT_ID=$PROJECT_ID
GCS_BACKUP_BUCKET=$BUCKET_NAME
GCS_KEY_FILE_PATH=$KEY_FILE_PATH

# Backup Configuration
BACKUP_RETENTION_DAYS=30

# Optional: Notification Webhook (Slack/Discord)
# BACKUP_NOTIFICATION_WEBHOOK=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
EOF

echo "  ✅ Environment file created: $ENV_FILE"

# Install required Node.js dependencies
echo "📦 Installing Node.js dependencies..."
if [ -f "package.json" ]; then
    npm install @google-cloud/storage
    echo "  ✅ Dependencies installed"
else
    echo "  ⚠️  No package.json found. You'll need to install @google-cloud/storage manually"
fi

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Edit $ENV_FILE and fill in your Supabase credentials:"
echo "   - NEXT_PUBLIC_SUPABASE_URL"
echo "   - SUPABASE_DB_PASSWORD"
echo "   - SUPABASE_PROJECT_REF"
echo ""
echo "2. Test the backup script:"
echo "   node scripts/supabase-backup-to-gcs.js"
echo ""
echo "3. Set up a cron job for automated backups:"
echo "   crontab -e"
echo "   Add: 0 2 * * * cd $(pwd) && node scripts/supabase-backup-to-gcs.js"
echo ""
echo "4. Verify your first backup in the GCS console:"
echo "   https://console.cloud.google.com/storage/browser/$BUCKET_NAME"
echo ""
echo "🔒 Security Note: Keep your service account key file secure and never commit it to version control!"

# Add to .gitignore if it exists
if [ -f ".gitignore" ]; then
    if ! grep -q "gcp-service-account-key.json" .gitignore; then
        echo "" >> .gitignore
        echo "# GCP Service Account Key" >> .gitignore
        echo "gcp-service-account-key.json" >> .gitignore
        echo ".env.backup" >> .gitignore
        echo "  ✅ Added sensitive files to .gitignore"
    fi
fi
