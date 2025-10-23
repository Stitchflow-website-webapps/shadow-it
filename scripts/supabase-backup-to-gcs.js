#!/usr/bin/env node

/**
 * Automated Supabase Database Backup to Google Cloud Storage
 * 
 * This script creates logical backups of your Supabase database and uploads them to GCS.
 * It follows Supabase's recommended backup approach with separate files for roles, schema, and data.
 * 
 * Prerequisites:
 * 1. Supabase CLI installed: npm install -g supabase
 * 2. Google Cloud SDK installed and authenticated
 * 3. Environment variables configured (see .env.example)
 * 
 * Usage: node scripts/supabase-backup-to-gcs.js
 */

const { exec } = require('child_process');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

// Configuration
const CONFIG = {
  // Supabase connection details
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePassword: process.env.SUPABASE_DB_PASSWORD,
  supabaseProjectRef: process.env.SUPABASE_PROJECT_REF,
  
  // Google Cloud Storage configuration
  gcsProjectId: process.env.GCS_PROJECT_ID,
  gcsBucketName: process.env.GCS_BACKUP_BUCKET,
  gcsKeyFilePath: process.env.GCS_KEY_FILE_PATH, // Path to service account JSON
  
  // Backup configuration
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
  tempDir: './temp-backups',
  
  // Notification settings
  notificationWebhook: process.env.BACKUP_NOTIFICATION_WEBHOOK, // Optional: Slack/Discord webhook
};

class SupabaseBackupManager {
  constructor() {
    this.storage = new Storage({
      projectId: CONFIG.gcsProjectId,
      keyFilename: CONFIG.gcsKeyFilePath,
    });
    this.bucket = this.storage.bucket(CONFIG.gcsBucketName);
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.backupDir = path.join(CONFIG.tempDir, this.timestamp);
  }

  async validateEnvironment() {
    console.log('🔍 Validating environment...');
    
    const requiredVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_DB_PASSWORD', 
      'SUPABASE_PROJECT_REF',
      'GCS_PROJECT_ID',
      'GCS_BACKUP_BUCKET'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Check if Supabase CLI is installed
    try {
      await execAsync('supabase --version');
      console.log('✅ Supabase CLI found');
    } catch (error) {
      throw new Error('Supabase CLI not found. Install with: npm install -g supabase');
    }

    // Verify GCS bucket access
    try {
      await this.bucket.exists();
      console.log('✅ GCS bucket accessible');
    } catch (error) {
      throw new Error(`Cannot access GCS bucket: ${error.message}`);
    }
  }

  buildConnectionString() {
    const { supabaseUrl, supabasePassword, supabaseProjectRef } = CONFIG;
    
    // Extract project ref from URL if not provided separately
    const projectRef = supabaseProjectRef || supabaseUrl.match(/https:\/\/([^.]+)/)?.[1];
    
    if (!projectRef) {
      throw new Error('Could not determine Supabase project reference');
    }

    // Use session pooler connection string (recommended for backups)
    return `postgresql://postgres.${projectRef}:${supabasePassword}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
  }

  async createBackupDirectory() {
    console.log(`📁 Creating backup directory: ${this.backupDir}`);
    
    if (!fs.existsSync(CONFIG.tempDir)) {
      fs.mkdirSync(CONFIG.tempDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async createDatabaseBackups() {
    console.log('💾 Creating database backups...');
    
    const connectionString = this.buildConnectionString();
    const backupFiles = {
      roles: path.join(this.backupDir, 'roles.sql'),
      schema: path.join(this.backupDir, 'schema.sql'),
      data: path.join(this.backupDir, 'data.sql'),
    };

    try {
      // 1. Backup roles
      console.log('  📋 Backing up roles...');
      await execAsync(`supabase db dump --db-url "${connectionString}" -f "${backupFiles.roles}" --role-only`);
      
      // 2. Backup schema
      console.log('  🏗️  Backing up schema...');
      await execAsync(`supabase db dump --db-url "${connectionString}" -f "${backupFiles.schema}"`);
      
      // 3. Backup data
      console.log('  📊 Backing up data...');
      await execAsync(`supabase db dump --db-url "${connectionString}" -f "${backupFiles.data}" --use-copy --data-only`);
      
      console.log('✅ Database backups created successfully');
      return backupFiles;
      
    } catch (error) {
      throw new Error(`Database backup failed: ${error.message}`);
    }
  }

  async uploadToGCS(backupFiles) {
    console.log('☁️  Uploading backups to Google Cloud Storage...');
    
    const uploadPromises = Object.entries(backupFiles).map(async ([type, filePath]) => {
      const fileName = path.basename(filePath);
      const gcsPath = `backups/${this.timestamp}/${fileName}`;
      
      console.log(`  📤 Uploading ${fileName}...`);
      
      await this.bucket.upload(filePath, {
        destination: gcsPath,
        metadata: {
          metadata: {
            backupType: type,
            timestamp: this.timestamp,
            supabaseProject: CONFIG.supabaseProjectRef,
            createdBy: 'automated-backup-script'
          }
        }
      });
      
      return { type, gcsPath, size: fs.statSync(filePath).size };
    });

    const uploadResults = await Promise.all(uploadPromises);
    console.log('✅ All backups uploaded to GCS');
    
    return uploadResults;
  }

  async createManifest(uploadResults) {
    console.log('📋 Creating backup manifest...');
    
    const manifest = {
      timestamp: this.timestamp,
      supabaseProject: CONFIG.supabaseProjectRef,
      backupType: 'logical',
      files: uploadResults,
      totalSize: uploadResults.reduce((sum, file) => sum + file.size, 0),
      createdAt: new Date().toISOString(),
      restorationInstructions: {
        note: "Use these files to restore your Supabase database",
        command: "psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname [CONNECTION_STRING]"
      }
    };

    const manifestPath = path.join(this.backupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Upload manifest to GCS
    const gcsManifestPath = `backups/${this.timestamp}/manifest.json`;
    await this.bucket.upload(manifestPath, {
      destination: gcsManifestPath,
      metadata: {
        contentType: 'application/json'
      }
    });

    console.log('✅ Backup manifest created');
    return manifest;
  }

  async cleanupOldBackups() {
    console.log('🧹 Cleaning up old backups...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.backupRetentionDays);
    
    try {
      const [files] = await this.bucket.getFiles({
        prefix: 'backups/',
      });

      const filesToDelete = files.filter(file => {
        const fileDate = new Date(file.metadata.timeCreated);
        return fileDate < cutoffDate;
      });

      if (filesToDelete.length > 0) {
        console.log(`  🗑️  Deleting ${filesToDelete.length} old backup files...`);
        await Promise.all(filesToDelete.map(file => file.delete()));
        console.log('✅ Old backups cleaned up');
      } else {
        console.log('  ℹ️  No old backups to clean up');
      }
    } catch (error) {
      console.warn(`⚠️  Warning: Could not clean up old backups: ${error.message}`);
    }
  }

  async cleanupTempFiles() {
    console.log('🧹 Cleaning up temporary files...');
    
    try {
      if (fs.existsSync(this.backupDir)) {
        fs.rmSync(this.backupDir, { recursive: true, force: true });
      }
      console.log('✅ Temporary files cleaned up');
    } catch (error) {
      console.warn(`⚠️  Warning: Could not clean up temp files: ${error.message}`);
    }
  }

  async sendNotification(success, manifest = null, error = null) {
    if (!CONFIG.notificationWebhook) return;

    const payload = {
      text: success 
        ? `✅ Supabase backup completed successfully\nTimestamp: ${this.timestamp}\nTotal size: ${this.formatBytes(manifest?.totalSize || 0)}`
        : `❌ Supabase backup failed\nError: ${error?.message || 'Unknown error'}`,
      timestamp: new Date().toISOString()
    };

    try {
      const response = await fetch(CONFIG.notificationWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        console.log('📱 Notification sent');
      }
    } catch (error) {
      console.warn(`⚠️  Could not send notification: ${error.message}`);
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async run() {
    const startTime = Date.now();
    console.log(`🚀 Starting Supabase backup process at ${new Date().toISOString()}`);
    
    try {
      await this.validateEnvironment();
      await this.createBackupDirectory();
      
      const backupFiles = await this.createDatabaseBackups();
      const uploadResults = await this.uploadToGCS(backupFiles);
      const manifest = await this.createManifest(uploadResults);
      
      await this.cleanupOldBackups();
      await this.cleanupTempFiles();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Backup completed successfully in ${duration}s`);
      console.log(`📊 Total backup size: ${this.formatBytes(manifest.totalSize)}`);
      console.log(`☁️  GCS path: gs://${CONFIG.gcsBucketName}/backups/${this.timestamp}/`);
      
      await this.sendNotification(true, manifest);
      
    } catch (error) {
      console.error(`❌ Backup failed: ${error.message}`);
      await this.cleanupTempFiles();
      await this.sendNotification(false, null, error);
      process.exit(1);
    }
  }
}

// Run the backup if this script is executed directly
if (require.main === module) {
  const backupManager = new SupabaseBackupManager();
  backupManager.run();
}

module.exports = SupabaseBackupManager;
