#!/usr/bin/env node

/**
 * Test script for Spoton sync with CPU optimization
 * 
 * Usage:
 * node scripts/test-spoton-sync.js [BASE_URL]
 * 
 * Examples:
 * node scripts/test-spoton-sync.js https://your-render-app.onrender.com
 * node scripts/test-spoton-sync.js http://localhost:3000
 */

const https = require('https');
const http = require('http');

async function testSpotonSync(baseUrl) {
  const url = `${baseUrl}/api/background/test-spoton-sync`;
  
  console.log('🧪 Starting Spoton sync test...');
  console.log(`📡 Calling: ${url}`);
  console.log('⏱️  This may take 10-30 minutes for a large organization like Spoton...\n');
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Test failed with HTTP error:');
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }
    
    const result = await response.json();
    
    console.log('✅ Test completed successfully!');
    console.log(`⏱️  Total duration: ${duration} seconds (${Math.round(duration/60)} minutes)`);
    console.log('\n📊 Results:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.memoryUsage) {
      console.log('\n🧠 Memory Usage Summary:');
      console.log(`Start: ${result.memoryUsage.start.heapUsed} heap, ${result.memoryUsage.start.rss} RSS`);
      console.log(`End: ${result.memoryUsage.end.heapUsed} heap, ${result.memoryUsage.end.rss} RSS`);
      console.log(`Increase: ${result.memoryUsage.increase}`);
    }
    
    if (result.testNotes) {
      console.log('\n📝 Test Notes:');
      result.testNotes.forEach(note => console.log(`  ${note}`));
    }
    
  } catch (error) {
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    
    console.error('❌ Test failed with error:');
    console.error(error.message);
    console.error(`⏱️  Failed after: ${duration} seconds`);
    process.exit(1);
  }
}

// Get base URL from command line argument or use default
const baseUrl = process.argv[2] || 'http://localhost:3000';

// Validate URL
try {
  new URL(baseUrl);
} catch (error) {
  console.error('❌ Invalid URL provided:', baseUrl);
  console.error('Usage: node scripts/test-spoton-sync.js [BASE_URL]');
  console.error('Example: node scripts/test-spoton-sync.js https://your-app.onrender.com');
  process.exit(1);
}

// Add fetch polyfill for older Node.js versions
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testSpotonSync(baseUrl); 