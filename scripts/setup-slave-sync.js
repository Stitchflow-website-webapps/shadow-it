#!/usr/bin/env node

/**
 * Setup script for Slave-to-Prod Sync using QStash
 * 
 * This script will:
 * 1. Validate environment variables
 * 2. Create the recurring sync schedule
 * 3. Provide management instructions
 */

const https = require('https');
const http = require('http');

// Configuration
const config = {
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://your-app-domain.vercel.app',
  qstashToken: process.env.QSTASH_TOKEN,
  qstashCurrentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  qstashNextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
};

function validateEnvironment() {
  console.log('🔍 Validating environment variables...');
  
  const required = [
    'QSTASH_TOKEN',
    'QSTASH_CURRENT_SIGNING_KEY', 
    'QSTASH_NEXT_SIGNING_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease add these to your .env.local file or environment:');
    console.error('QSTASH_TOKEN="your-token"');
    console.error('QSTASH_CURRENT_SIGNING_KEY="your-current-key"');
    console.error('QSTASH_NEXT_SIGNING_KEY="your-next-key"');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

function makeRequest(url, method, data) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const requestModule = isHttps ? https : http;
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (data) {
      const postData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = requestModule.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: responseData });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function createSyncSchedule() {
  console.log('🕐 Creating slave-to-prod sync schedule...');
  
  try {
    const response = await makeRequest(
      `${config.baseUrl}/api/background/sync/schedule`,
      'POST',
      {
        action: 'create',
        baseUrl: config.baseUrl
      }
    );
    
    if (response.statusCode === 200 && response.data.success) {
      console.log('✅ Sync schedule created successfully!');
      console.log(`📋 Schedule ID: ${response.data.scheduleId}`);
      console.log(`⏰ Schedule: ${response.data.schedule.description}`);
      console.log(`🔗 URL: ${response.data.schedule.url}`);
      
      // Save schedule ID for future reference
      console.log('\n📝 Save this Schedule ID for future management:');
      console.log(`SLAVE_SYNC_SCHEDULE_ID="${response.data.scheduleId}"`);
      
      return response.data.scheduleId;
    } else {
      console.error('❌ Failed to create schedule:', response.data);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error creating schedule:', error.message);
    process.exit(1);
  }
}

async function listExistingSchedules() {
  console.log('📋 Checking for existing sync schedules...');
  
  try {
    const response = await makeRequest(
      `${config.baseUrl}/api/background/sync/schedule`,
      'GET'
    );
    
    if (response.statusCode === 200 && response.data.success) {
      const schedules = response.data.schedules;
      
      if (schedules.length > 0) {
        console.log(`📊 Found ${schedules.length} existing sync schedule(s):`);
        schedules.forEach((schedule, index) => {
          console.log(`   ${index + 1}. ID: ${schedule.scheduleId}`);
          console.log(`      Cron: ${schedule.cron}`);
          console.log(`      Status: ${schedule.isPaused ? 'Paused' : 'Active'}`);
          console.log(`      URL: ${schedule.destination}`);
        });
        
        const hasActive = schedules.some(s => !s.isPaused);
        if (hasActive) {
          console.log('\n⚠️  Active schedules already exist. Consider pausing or deleting them before creating a new one.');
          return true;
        }
      } else {
        console.log('📭 No existing sync schedules found');
      }
      
      return false;
    } else {
      console.log('⚠️  Could not fetch existing schedules (this is okay for first setup)');
      return false;
    }
  } catch (error) {
    console.log('⚠️  Could not check existing schedules (this is okay for first setup)');
    return false;
  }
}

async function testManualSync() {
  console.log('🧪 Testing manual sync trigger...');
  
  try {
    const response = await makeRequest(
      `${config.baseUrl}/api/background/sync/schedule`,
      'POST',
      {
        action: 'trigger-manual',
        baseUrl: config.baseUrl
      }
    );
    
    if (response.statusCode === 200 && response.data.success) {
      console.log('✅ Manual sync triggered successfully!');
      console.log(`📨 Message ID: ${response.data.messageId}`);
    } else {
      console.log('⚠️  Manual sync test failed (schedule will still work):', response.data);
    }
  } catch (error) {
    console.log('⚠️  Manual sync test failed (schedule will still work):', error.message);
  }
}

function printManagementInstructions(scheduleId) {
  console.log('\n' + '='.repeat(60));
  console.log('📚 SLAVE-TO-PROD SYNC MANAGEMENT');
  console.log('='.repeat(60));
  
  console.log('\n🔧 To manage your sync schedule, use these API calls:');
  
  console.log('\n📋 List all schedules:');
  console.log(`curl -X GET ${config.baseUrl}/api/background/sync/schedule`);
  
  console.log('\n⏸️  Pause the schedule:');
  console.log(`curl -X POST ${config.baseUrl}/api/background/sync/schedule \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"action": "pause", "scheduleId": "${scheduleId}"}'`);
  
  console.log('\n▶️  Resume the schedule:');
  console.log(`curl -X POST ${config.baseUrl}/api/background/sync/schedule \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"action": "resume", "scheduleId": "${scheduleId}"}'`);
  
  console.log('\n🚀 Trigger manual sync:');
  console.log(`curl -X POST ${config.baseUrl}/api/background/sync/schedule \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"action": "trigger-manual"}'`);
  
  console.log('\n🗑️  Delete the schedule:');
  console.log(`curl -X POST ${config.baseUrl}/api/background/sync/schedule \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"action": "delete", "scheduleId": "${scheduleId}"}'`);
  
  console.log('\n📊 Monitor sync logs:');
  console.log('Check your application logs for sync status and results.');
  
  console.log('\n⏰ Schedule Details:');
  console.log('- Frequency: Every 6 hours');
  console.log('- Cron: 0 */6 * * *');
  console.log('- Retries: 2 attempts on failure');
  console.log('- Endpoint: /api/background/sync/slave-to-prod');
}

async function main() {
  console.log('🚀 Setting up Slave-to-Prod Sync with QStash');
  console.log('='.repeat(50));
  
  // Step 1: Validate environment
  validateEnvironment();
  
  // Step 2: Check existing schedules
  const hasExisting = await listExistingSchedules();
  
  if (hasExisting) {
    console.log('\n❓ Do you want to continue creating a new schedule? (Press Ctrl+C to cancel)');
    // In a real implementation, you might want to add user input here
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Step 3: Create new schedule
  const scheduleId = await createSyncSchedule();
  
  // Step 4: Test manual trigger
  await testManualSync();
  
  // Step 5: Print management instructions
  printManagementInstructions(scheduleId);
  
  console.log('\n✅ Setup completed successfully!');
  console.log('🎉 Your slave-to-prod sync is now running every 6 hours.');
}

// Run the setup
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  });
}

module.exports = { main, validateEnvironment, createSyncSchedule }; 