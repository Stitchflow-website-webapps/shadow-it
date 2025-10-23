#!/usr/bin/env node

/**
 * Supabase Backup Monitoring and Alerting System
 * 
 * This script monitors backup status and sends alerts when issues are detected.
 * It can be run as a separate cron job to monitor the main backup process.
 * 
 * Features:
 * - Checks for recent successful backups
 * - Monitors backup failures
 * - Sends notifications via webhook (Slack/Discord/Teams)
 * - Generates backup health reports
 * - Monitors GCS bucket status
 * 
 * Usage: node scripts/backup-monitoring.js
 */

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Google Cloud Storage configuration
  gcsProjectId: process.env.GCS_PROJECT_ID,
  gcsBucketName: process.env.GCS_BACKUP_BUCKET,
  gcsKeyFilePath: process.env.GCS_KEY_FILE_PATH,
  
  // Monitoring thresholds
  maxHoursSinceLastBackup: parseInt(process.env.MAX_HOURS_SINCE_BACKUP) || 25,
  maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES) || 3,
  minBackupSize: parseInt(process.env.MIN_BACKUP_SIZE_MB) || 1, // MB
  
  // Notification settings
  notificationWebhook: process.env.BACKUP_NOTIFICATION_WEBHOOK,
  alertWebhook: process.env.BACKUP_ALERT_WEBHOOK || process.env.BACKUP_NOTIFICATION_WEBHOOK,
  
  // File paths
  logFile: './logs/backup.log',
  statusFile: './logs/backup-status.json',
  
  // Alert settings
  alertCooldownHours: parseInt(process.env.ALERT_COOLDOWN_HOURS) || 4,
};

class BackupMonitor {
  constructor() {
    this.storage = new Storage({
      projectId: CONFIG.gcsProjectId,
      keyFilename: CONFIG.gcsKeyFilePath,
    });
    this.bucket = this.storage.bucket(CONFIG.gcsBucketName);
    this.alerts = [];
    this.status = this.loadStatus();
  }

  loadStatus() {
    try {
      if (fs.existsSync(CONFIG.statusFile)) {
        return JSON.parse(fs.readFileSync(CONFIG.statusFile, 'utf8'));
      }
    } catch (error) {
      console.warn('Could not load status file:', error.message);
    }
    
    return {
      lastAlertTime: null,
      consecutiveFailures: 0,
      lastSuccessfulBackup: null,
      lastCheckedTime: null
    };
  }

  saveStatus() {
    try {
      const statusDir = path.dirname(CONFIG.statusFile);
      if (!fs.existsSync(statusDir)) {
        fs.mkdirSync(statusDir, { recursive: true });
      }
      
      this.status.lastCheckedTime = new Date().toISOString();
      fs.writeFileSync(CONFIG.statusFile, JSON.stringify(this.status, null, 2));
    } catch (error) {
      console.warn('Could not save status file:', error.message);
    }
  }

  async checkLogFile() {
    console.log('📋 Checking backup log file...');
    
    if (!fs.existsSync(CONFIG.logFile)) {
      this.addAlert('critical', 'Backup log file not found', 'The backup log file does not exist. Backups may not be running.');
      return null;
    }

    const logContent = fs.readFileSync(CONFIG.logFile, 'utf8');
    const lines = logContent.split('\n').filter(line => line.trim());
    
    // Find last successful backup
    const successLines = lines.filter(line => line.includes('Backup completed successfully'));
    const lastSuccess = successLines.length > 0 ? successLines[successLines.length - 1] : null;
    
    // Find recent failures
    const failureLines = lines.filter(line => line.includes('Backup failed'));
    const recentFailures = failureLines.slice(-CONFIG.maxConsecutiveFailures);
    
    // Parse last successful backup time
    let lastSuccessTime = null;
    if (lastSuccess) {
      const timeMatch = lastSuccess.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
      if (timeMatch) {
        lastSuccessTime = new Date(timeMatch[1]);
        this.status.lastSuccessfulBackup = lastSuccessTime.toISOString();
      }
    }

    // Check if backup is overdue
    if (lastSuccessTime) {
      const hoursSinceLastBackup = (Date.now() - lastSuccessTime.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastBackup > CONFIG.maxHoursSinceLastBackup) {
        this.addAlert('warning', 'Backup overdue', 
          `Last successful backup was ${Math.round(hoursSinceLastBackup)} hours ago (threshold: ${CONFIG.maxHoursSinceLastBackup} hours)`);
      }
    } else {
      this.addAlert('critical', 'No successful backups found', 'No successful backup entries found in the log file');
    }

    // Check for consecutive failures
    const consecutiveFailures = this.countConsecutiveFailures(lines);
    this.status.consecutiveFailures = consecutiveFailures;
    
    if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
      this.addAlert('critical', 'Multiple backup failures', 
        `${consecutiveFailures} consecutive backup failures detected`);
    }

    return {
      lastSuccessTime,
      consecutiveFailures,
      totalFailures: failureLines.length,
      logSize: fs.statSync(CONFIG.logFile).size
    };
  }

  countConsecutiveFailures(logLines) {
    let consecutiveFailures = 0;
    
    // Look at recent backup attempts (last 10 lines that mention backup status)
    const backupStatusLines = logLines
      .filter(line => line.includes('Backup completed successfully') || line.includes('Backup failed'))
      .slice(-10)
      .reverse(); // Most recent first
    
    for (const line of backupStatusLines) {
      if (line.includes('Backup failed')) {
        consecutiveFailures++;
      } else if (line.includes('Backup completed successfully')) {
        break; // Stop counting when we hit a success
      }
    }
    
    return consecutiveFailures;
  }

  async checkGCSBucket() {
    console.log('☁️  Checking GCS bucket status...');
    
    try {
      const [exists] = await this.bucket.exists();
      if (!exists) {
        this.addAlert('critical', 'GCS bucket not found', `Backup bucket ${CONFIG.gcsBucketName} does not exist`);
        return null;
      }

      // List recent backups
      const [files] = await this.bucket.getFiles({
        prefix: 'backups/',
        maxResults: 50
      });

      if (files.length === 0) {
        this.addAlert('warning', 'No backups in GCS', 'No backup files found in the GCS bucket');
        return { backupCount: 0, totalSize: 0, latestBackup: null };
      }

      // Get backup statistics
      const backupFolders = new Set();
      let totalSize = 0;
      let latestBackupTime = null;

      files.forEach(file => {
        const match = file.name.match(/backups\/([^\/]+)\//);
        if (match) {
          backupFolders.add(match[1]);
          totalSize += parseInt(file.metadata.size) || 0;
          
          // Parse backup timestamp
          try {
            const backupTime = new Date(match[1].replace(/-/g, ':').replace(/T/, 'T').replace(/Z$/, '.000Z'));
            if (!latestBackupTime || backupTime > latestBackupTime) {
              latestBackupTime = backupTime;
            }
          } catch (error) {
            // Ignore parsing errors
          }
        }
      });

      // Check if latest backup is too small (might indicate incomplete backup)
      if (latestBackupTime) {
        const latestBackupPrefix = latestBackupTime.toISOString().replace(/[:.]/g, '-').replace(/\.000Z$/, 'Z');
        const latestBackupFiles = files.filter(file => file.name.includes(latestBackupPrefix));
        const latestBackupSize = latestBackupFiles.reduce((sum, file) => sum + (parseInt(file.metadata.size) || 0), 0);
        
        if (latestBackupSize < CONFIG.minBackupSize * 1024 * 1024) {
          this.addAlert('warning', 'Small backup detected', 
            `Latest backup is only ${this.formatBytes(latestBackupSize)} (minimum expected: ${CONFIG.minBackupSize}MB)`);
        }
      }

      return {
        backupCount: backupFolders.size,
        totalSize,
        latestBackup: latestBackupTime
      };

    } catch (error) {
      this.addAlert('critical', 'GCS access error', `Cannot access GCS bucket: ${error.message}`);
      return null;
    }
  }

  addAlert(level, title, message) {
    this.alerts.push({
      level,
      title,
      message,
      timestamp: new Date().toISOString()
    });
  }

  shouldSendAlert() {
    // Check if we're in cooldown period
    if (this.status.lastAlertTime) {
      const hoursSinceLastAlert = (Date.now() - new Date(this.status.lastAlertTime).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastAlert < CONFIG.alertCooldownHours) {
        console.log(`⏰ Alert cooldown active (${Math.round(hoursSinceLastAlert)}h/${CONFIG.alertCooldownHours}h)`);
        return false;
      }
    }

    // Only send alerts for critical issues or multiple warnings
    const criticalAlerts = this.alerts.filter(alert => alert.level === 'critical');
    const warningAlerts = this.alerts.filter(alert => alert.level === 'warning');
    
    return criticalAlerts.length > 0 || warningAlerts.length >= 2;
  }

  async sendNotification(isAlert = false) {
    const webhook = isAlert ? CONFIG.alertWebhook : CONFIG.notificationWebhook;
    
    if (!webhook) {
      console.log('📱 No webhook configured for notifications');
      return;
    }

    const alertsByLevel = {
      critical: this.alerts.filter(a => a.level === 'critical'),
      warning: this.alerts.filter(a => a.level === 'warning'),
      info: this.alerts.filter(a => a.level === 'info')
    };

    let message = isAlert ? '🚨 **Backup Alert**' : '📊 **Backup Status Report**';
    message += `\nTime: ${new Date().toLocaleString()}`;
    
    if (alertsByLevel.critical.length > 0) {
      message += '\n\n❌ **Critical Issues:**';
      alertsByLevel.critical.forEach(alert => {
        message += `\n• ${alert.title}: ${alert.message}`;
      });
    }
    
    if (alertsByLevel.warning.length > 0) {
      message += '\n\n⚠️ **Warnings:**';
      alertsByLevel.warning.forEach(alert => {
        message += `\n• ${alert.title}: ${alert.message}`;
      });
    }
    
    if (alertsByLevel.info.length > 0) {
      message += '\n\n ℹ️ **Information:**';
      alertsByLevel.info.forEach(alert => {
        message += `\n• ${alert.title}: ${alert.message}`;
      });
    }

    if (this.alerts.length === 0) {
      message += '\n\n✅ All backup checks passed';
    }

    const payload = {
      text: message,
      timestamp: new Date().toISOString()
    };

    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        console.log('📱 Notification sent successfully');
        if (isAlert) {
          this.status.lastAlertTime = new Date().toISOString();
        }
      } else {
        console.warn('⚠️ Failed to send notification:', response.statusText);
      }
    } catch (error) {
      console.warn(`⚠️ Could not send notification: ${error.message}`);
    }
  }

  generateReport(logStatus, gcsStatus) {
    console.log('\n📊 Backup Health Report');
    console.log('========================');
    console.log(`Generated: ${new Date().toLocaleString()}`);
    
    if (logStatus) {
      console.log('\n📋 Log File Status:');
      console.log(`  Last successful backup: ${logStatus.lastSuccessTime ? logStatus.lastSuccessTime.toLocaleString() : 'None found'}`);
      console.log(`  Consecutive failures: ${logStatus.consecutiveFailures}`);
      console.log(`  Total failures in log: ${logStatus.totalFailures}`);
      console.log(`  Log file size: ${this.formatBytes(logStatus.logSize)}`);
    }
    
    if (gcsStatus) {
      console.log('\n☁️ GCS Bucket Status:');
      console.log(`  Total backups: ${gcsStatus.backupCount}`);
      console.log(`  Total storage used: ${this.formatBytes(gcsStatus.totalSize)}`);
      console.log(`  Latest backup: ${gcsStatus.latestBackup ? gcsStatus.latestBackup.toLocaleString() : 'None found'}`);
    }
    
    if (this.alerts.length > 0) {
      console.log('\n🚨 Alerts:');
      this.alerts.forEach(alert => {
        const icon = alert.level === 'critical' ? '❌' : alert.level === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} ${alert.title}: ${alert.message}`);
      });
    } else {
      console.log('\n✅ No issues detected');
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
    console.log(`🔍 Starting backup monitoring at ${new Date().toISOString()}`);
    
    try {
      // Check log file
      const logStatus = await this.checkLogFile();
      
      // Check GCS bucket
      const gcsStatus = await this.checkGCSBucket();
      
      // Generate report
      this.generateReport(logStatus, gcsStatus);
      
      // Send notifications if needed
      if (this.shouldSendAlert()) {
        await this.sendNotification(true);
      } else if (this.alerts.length === 0) {
        // Send periodic health report (only if no issues)
        const lastReport = this.status.lastReportTime;
        const hoursSinceLastReport = lastReport ? 
          (Date.now() - new Date(lastReport).getTime()) / (1000 * 60 * 60) : 999;
        
        if (hoursSinceLastReport >= 24) { // Daily health report
          await this.sendNotification(false);
          this.status.lastReportTime = new Date().toISOString();
        }
      }
      
      // Save status
      this.saveStatus();
      
      console.log('✅ Monitoring completed');
      
    } catch (error) {
      console.error(`❌ Monitoring failed: ${error.message}`);
      
      // Send critical alert about monitoring failure
      this.addAlert('critical', 'Monitoring system failure', error.message);
      await this.sendNotification(true);
      
      process.exit(1);
    }
  }
}

// Run the monitor if this script is executed directly
if (require.main === module) {
  const monitor = new BackupMonitor();
  monitor.run();
}

module.exports = BackupMonitor;
