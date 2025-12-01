#!/usr/bin/env node

/**
 * Supabase Database Restore from Google Cloud Storage
 * 
 * This script restores a Supabase database from backups stored in GCS.
 * It follows Supabase's recommended restoration process.
 * 
 * Prerequisites:
 * 1. Supabase CLI installed: npm install -g supabase
 * 2. Google Cloud SDK installed and authenticated
 * 3. psql installed (PostgreSQL client)
 * 4. Environment variables configured
 * 
 * Usage: 
 *   node scripts/restore-from-gcs-backup.js [backup-timestamp]
 *   node scripts/restore-from-gcs-backup.js 2024-01-15T02-00-00-000Z
 */

const { exec } = require('child_process');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const util = require('util');
const readline = require('readline');

const execAsync = util.promisify(exec);

// Configuration
const CONFIG = {
  // Target Supabase connection details (where to restore)
  targetSupabaseUrl: process.env.TARGET_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  targetSupabasePassword: process.env.TARGET_SUPABASE_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
  targetSupabaseProjectRef: process.env.TARGET_SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF,
  
  // Google Cloud Storage configuration
  gcsProjectId: process.env.GCS_PROJECT_ID,
  gcsBucketName: process.env.GCS_BACKUP_BUCKET,
  gcsKeyFilePath: process.env.GCS_KEY_FILE_PATH,
  
  // Restore configuration
  tempDir: './temp-restore',
  
  // Safety settings
  requireConfirmation: process.env.SKIP_CONFIRMATION !== 'true',
};

class SupabaseRestoreManager {
  constructor(backupTimestamp = null) {
    this.storage = new Storage({
      projectId: CONFIG.gcsProjectId,
      keyFilename: CONFIG.gcsKeyFilePath,
    });
    this.bucket = this.storage.bucket(CONFIG.gcsBucketName);
    this.backupTimestamp = backupTimestamp;
    this.restoreDir = path.join(CONFIG.tempDir, 'restore-' + Date.now());
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async validateEnvironment() {
    console.log('🔍 Validating environment...');
    
    const requiredVars = [
      'TARGET_SUPABASE_URL',
      'TARGET_SUPABASE_PASSWORD', 
      'TARGET_SUPABASE_PROJECT_REF',
      'GCS_PROJECT_ID',
      'GCS_BACKUP_BUCKET'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName] && !process.env[varName.replace('TARGET_', '')]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Check required tools
    const tools = [
      { name: 'supabase', command: 'supabase --version' },
      { name: 'psql', command: 'psql --version' },
      { name: 'gsutil', command: 'gsutil version' }
    ];

    for (const tool of tools) {
      try {
        await execAsync(tool.command);
        console.log(`✅ ${tool.name} found`);
      } catch (error) {
        throw new Error(`${tool.name} not found. Please install it first.`);
      }
    }

    // Verify GCS bucket access
    try {
      await this.bucket.exists();
      console.log('✅ GCS bucket accessible');
    } catch (error) {
      throw new Error(`Cannot access GCS bucket: ${error.message}`);
    }
  }

  async listAvailableBackups() {
    console.log('📋 Listing available backups...');
    
    try {
      const [files] = await this.bucket.getFiles({
        prefix: 'backups/',
        delimiter: '/'
      });

      // Extract unique backup timestamps
      const backupTimestamps = new Set();
      files.forEach(file => {
        const match = file.name.match(/backups\/([^\/]+)\//);
        if (match) {
          backupTimestamps.add(match[1]);
        }
      });

      const sortedBackups = Array.from(backupTimestamps).sort().reverse();
      
      if (sortedBackups.length === 0) {
        throw new Error('No backups found in GCS bucket');
      }

      console.log('\nAvailable backups:');
      sortedBackups.forEach((timestamp, index) => {
        const date = new Date(timestamp.replace(/-/g, ':').replace(/T/, 'T').replace(/Z$/, '.000Z'));
        console.log(`  ${index + 1}. ${timestamp} (${date.toLocaleString()})`);
      });

      return sortedBackups;
    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  async selectBackup() {
    if (this.backupTimestamp) {
      console.log(`📅 Using specified backup: ${this.backupTimestamp}`);
      return this.backupTimestamp;
    }

    const availableBackups = await this.listAvailableBackups();
    
    console.log('\nSelect a backup to restore:');
    const answer = await this.question('Enter backup number (1 for most recent): ');
    
    const selectedIndex = parseInt(answer) - 1;
    if (selectedIndex < 0 || selectedIndex >= availableBackups.length) {
      throw new Error('Invalid backup selection');
    }

    this.backupTimestamp = availableBackups[selectedIndex];
    console.log(`✅ Selected backup: ${this.backupTimestamp}`);
    return this.backupTimestamp;
  }

  async downloadBackupFiles() {
    console.log('📥 Downloading backup files...');
    
    // Create restore directory
    if (!fs.existsSync(CONFIG.tempDir)) {
      fs.mkdirSync(CONFIG.tempDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.restoreDir)) {
      fs.mkdirSync(this.restoreDir, { recursive: true });
    }

    const backupFiles = ['roles.sql', 'schema.sql', 'data.sql', 'manifest.json'];
    const downloadedFiles = {};

    for (const fileName of backupFiles) {
      const gcsPath = `backups/${this.backupTimestamp}/${fileName}`;
      const localPath = path.join(this.restoreDir, fileName);
      
      console.log(`  📄 Downloading ${fileName}...`);
      
      try {
        await this.bucket.file(gcsPath).download({ destination: localPath });
        downloadedFiles[fileName.replace('.sql', '')] = localPath;
        console.log(`    ✅ Downloaded to ${localPath}`);
      } catch (error) {
        if (fileName === 'manifest.json') {
          console.log(`    ⚠️  Manifest not found (older backup format)`);
        } else {
          throw new Error(`Failed to download ${fileName}: ${error.message}`);
        }
      }
    }

    return downloadedFiles;
  }

  async displayBackupInfo(downloadedFiles) {
    const manifestPath = downloadedFiles.manifest || path.join(this.restoreDir, 'manifest.json');
    
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log('\n📊 Backup Information:');
        console.log(`  Timestamp: ${manifest.timestamp}`);
        console.log(`  Project: ${manifest.supabaseProject}`);
        console.log(`  Type: ${manifest.backupType}`);
        console.log(`  Total Size: ${this.formatBytes(manifest.totalSize)}`);
        console.log(`  Created: ${new Date(manifest.createdAt).toLocaleString()}`);
      } catch (error) {
        console.log('⚠️  Could not read backup manifest');
      }
    }

    // Show file sizes
    console.log('\n📁 Backup Files:');
    ['roles', 'schema', 'data'].forEach(type => {
      if (downloadedFiles[type] && fs.existsSync(downloadedFiles[type])) {
        const size = fs.statSync(downloadedFiles[type]).size;
        console.log(`  ${type}.sql: ${this.formatBytes(size)}`);
      }
    });
  }

  buildTargetConnectionString() {
    const { targetSupabaseUrl, targetSupabasePassword, targetSupabaseProjectRef } = CONFIG;
    
    // Extract project ref from URL if not provided separately
    const projectRef = targetSupabaseProjectRef || targetSupabaseUrl.match(/https:\/\/([^.]+)/)?.[1];
    
    if (!projectRef) {
      throw new Error('Could not determine target Supabase project reference');
    }

    // Use session pooler connection string (recommended for restore)
    return `postgresql://postgres.${projectRef}:${targetSupabasePassword}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
  }

  async confirmRestore() {
    if (!CONFIG.requireConfirmation) {
      return true;
    }

    console.log('\n⚠️  WARNING: Database Restore Operation');
    console.log('=====================================');
    console.log('This operation will:');
    console.log('1. COMPLETELY REPLACE the target database');
    console.log('2. Delete ALL existing data in the target database');
    console.log('3. Restore data from the selected backup');
    console.log('4. Cause downtime during the restoration process');
    console.log('');
    console.log(`Target Database: ${CONFIG.targetSupabaseUrl}`);
    console.log(`Backup Timestamp: ${this.backupTimestamp}`);
    console.log('');
    console.log('This action is IRREVERSIBLE!');
    console.log('');

    const confirmation1 = await this.question('Type "RESTORE" to confirm you want to proceed: ');
    if (confirmation1 !== 'RESTORE') {
      throw new Error('Restoration cancelled by user');
    }

    const confirmation2 = await this.question('Type "YES" to confirm you have backed up the target database: ');
    if (confirmation2 !== 'YES') {
      throw new Error('Restoration cancelled - please backup target database first');
    }

    console.log('✅ Restoration confirmed');
    return true;
  }

  async performRestore(downloadedFiles) {
    console.log('🔄 Starting database restoration...');
    
    const connectionString = this.buildTargetConnectionString();
    
    try {
      // Build the psql command following Supabase's recommended approach
      const restoreCommand = [
        'psql',
        '--single-transaction',
        '--variable', 'ON_ERROR_STOP=1',
        '--file', downloadedFiles.roles,
        '--file', downloadedFiles.schema,
        '--command', "'SET session_replication_role = replica'",
        '--file', downloadedFiles.data,
        '--dbname', `"${connectionString}"`
      ].join(' ');

      console.log('  🔧 Executing restoration command...');
      console.log(`  Command: ${restoreCommand.replace(connectionString, '[CONNECTION_STRING]')}`);
      
      const { stdout, stderr } = await execAsync(restoreCommand, {
        maxBuffer: 1024 * 1024 * 100 // 100MB buffer for large restores
      });

      if (stderr && !stderr.includes('NOTICE')) {
        console.warn('⚠️  Restoration warnings:');
        console.warn(stderr);
      }

      console.log('✅ Database restoration completed successfully');
      
      if (stdout) {
        console.log('📋 Restoration output:');
        console.log(stdout);
      }

    } catch (error) {
      throw new Error(`Database restoration failed: ${error.message}`);
    }
  }

  async cleanupTempFiles() {
    console.log('🧹 Cleaning up temporary files...');
    
    try {
      if (fs.existsSync(this.restoreDir)) {
        fs.rmSync(this.restoreDir, { recursive: true, force: true });
      }
      console.log('✅ Temporary files cleaned up');
    } catch (error) {
      console.warn(`⚠️  Warning: Could not clean up temp files: ${error.message}`);
    }
  }

  async question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
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
    console.log(`🚀 Starting Supabase database restoration at ${new Date().toISOString()}`);
    
    try {
      await this.validateEnvironment();
      await this.selectBackup();
      
      const downloadedFiles = await this.downloadBackupFiles();
      await this.displayBackupInfo(downloadedFiles);
      
      await this.confirmRestore();
      await this.performRestore(downloadedFiles);
      
      await this.cleanupTempFiles();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Restoration completed successfully in ${duration}s`);
      console.log('');
      console.log('🎯 Post-restoration checklist:');
      console.log('  1. Verify data integrity in the restored database');
      console.log('  2. Test application functionality');
      console.log('  3. Update any environment-specific configurations');
      console.log('  4. Restart your application if needed');
      
    } catch (error) {
      console.error(`❌ Restoration failed: ${error.message}`);
      await this.cleanupTempFiles();
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }
}

// Parse command line arguments
const backupTimestamp = process.argv[2];

if (require.main === module) {
  const restoreManager = new SupabaseRestoreManager(backupTimestamp);
  restoreManager.run();
}

module.exports = SupabaseRestoreManager;
