/**
 * Test script for the export-org-apps API endpoint
 * This script tests the export functionality for success@stitchflow.io
 */

const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  organizationId: 'dummy org id is needed', // From your SQL script
  userEmail: 'success@stitchflow.io',
  outputDir: './test-exports'
};

async function testExportOrgApps() {
  console.log('🧪 Testing Export Org Apps API...');
  console.log(`📍 Base URL: ${TEST_CONFIG.baseUrl}`);
  console.log(`🏢 Organization ID: ${TEST_CONFIG.organizationId}`);
  console.log(`👤 User Email: ${TEST_CONFIG.userEmail}`);
  
  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(TEST_CONFIG.outputDir)) {
      fs.mkdirSync(TEST_CONFIG.outputDir, { recursive: true });
    }

    // Make the API request
    console.log('\n📡 Making API request...');
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/admin/export-org-apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `userEmail=${TEST_CONFIG.userEmail}`
      },
      body: JSON.stringify({
        organizationId: TEST_CONFIG.organizationId
      })
    });

    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    console.log(`📋 Content-Type: ${contentType}`);
    
    if (!contentType || !contentType.includes('text/csv')) {
      console.warn('⚠️  Warning: Expected CSV content type, got:', contentType);
    }

    // Get the CSV data
    const csvData = await response.text();
    console.log(`📏 CSV Data Length: ${csvData.length} characters`);
    
    // Parse CSV headers and count rows
    const lines = csvData.split('\n').filter(line => line.trim());
    const headers = lines[0] ? lines[0].split(',') : [];
    const dataRows = lines.slice(1);
    
    console.log(`📊 CSV Headers (${headers.length}):`, headers.map(h => h.replace(/"/g, '')));
    console.log(`📈 Data Rows: ${dataRows.length}`);
    
    // Save the CSV file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-export-${timestamp}.csv`;
    const filepath = path.join(TEST_CONFIG.outputDir, filename);
    
    fs.writeFileSync(filepath, csvData);
    console.log(`💾 CSV saved to: ${filepath}`);
    
    // Analyze the data
    if (dataRows.length > 0) {
      console.log('\n📋 Sample data analysis:');
      
      // Parse first few rows
      const sampleRows = dataRows.slice(0, Math.min(3, dataRows.length));
      sampleRows.forEach((row, index) => {
        const values = row.split(',');
        console.log(`\n  Row ${index + 1}:`);
        headers.forEach((header, i) => {
          const value = values[i] || '';
          const cleanHeader = header.replace(/"/g, '');
          const cleanValue = value.replace(/"/g, '');
          if (cleanValue) {
            console.log(`    ${cleanHeader}: ${cleanValue.length > 50 ? cleanValue.substring(0, 50) + '...' : cleanValue}`);
          }
        });
      });
      
      // Check for high-risk user count column
      const highRiskIndex = headers.findIndex(h => h.toLowerCase().includes('high risk'));
      const totalUserIndex = headers.findIndex(h => h.toLowerCase().includes('total user'));
      
      if (highRiskIndex >= 0) {
        console.log(`\n📊 High Risk User Count Analysis:`);
        const highRiskCounts = dataRows.map(row => {
          const values = row.split(',');
          return parseInt(values[highRiskIndex] || '0');
        }).filter(count => !isNaN(count));
        
        const totalHighRisk = highRiskCounts.reduce((sum, count) => sum + count, 0);
        const maxHighRisk = Math.max(...highRiskCounts, 0);
        const appsWithHighRisk = highRiskCounts.filter(count => count > 0).length;
        
        console.log(`    Total high-risk users across all apps: ${totalHighRisk}`);
        console.log(`    Max high-risk users in single app: ${maxHighRisk}`);
        console.log(`    Apps with high-risk users: ${appsWithHighRisk}/${dataRows.length}`);
      }
      
      if (totalUserIndex >= 0) {
        console.log(`\n👥 Total User Count Analysis:`);
        const totalUserCounts = dataRows.map(row => {
          const values = row.split(',');
          return parseInt(values[totalUserIndex] || '0');
        }).filter(count => !isNaN(count));
        
        const totalUsers = totalUserCounts.reduce((sum, count) => sum + count, 0);
        const maxUsers = Math.max(...totalUserCounts, 0);
        const appsWithUsers = totalUserCounts.filter(count => count > 0).length;
        
        console.log(`    Total users across all apps: ${totalUsers}`);
        console.log(`    Max users in single app: ${maxUsers}`);
        console.log(`    Apps with users: ${appsWithUsers}/${dataRows.length}`);
      }
    }
    
    console.log('\n✅ Export test completed successfully!');
    return {
      success: true,
      filepath,
      rowCount: dataRows.length,
      headers: headers.map(h => h.replace(/"/g, ''))
    };
    
  } catch (error) {
    console.error('\n❌ Export test failed:');
    console.error(error.message);
    
    if (error.stack) {
      console.error('\n📚 Stack trace:');
      console.error(error.stack);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Test different scenarios
async function runAllTests() {
  console.log('🚀 Starting Export Org Apps Test Suite\n');
  
  const results = [];
  
  // Test 1: Valid request
  console.log('='.repeat(60));
  console.log('TEST 1: Valid Export Request');
  console.log('='.repeat(60));
  const result1 = await testExportOrgApps();
  results.push({ test: 'Valid Export', ...result1 });
  
  // Test 2: Invalid organization ID
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Invalid Organization ID');
  console.log('='.repeat(60));
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/admin/export-org-apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `userEmail=${TEST_CONFIG.userEmail}`
      },
      body: JSON.stringify({
        organizationId: 'invalid-org-id'
      })
    });
    
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    const responseText = await response.text();
    console.log(`📋 Response: ${responseText}`);
    
    results.push({ 
      test: 'Invalid Org ID', 
      success: response.status === 404,
      status: response.status,
      response: responseText
    });
  } catch (error) {
    results.push({ 
      test: 'Invalid Org ID', 
      success: false, 
      error: error.message 
    });
  }
  
  // Test 3: Unauthorized user
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Unauthorized User');
  console.log('='.repeat(60));
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/admin/export-org-apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'userEmail=unauthorized@example.com'
      },
      body: JSON.stringify({
        organizationId: TEST_CONFIG.organizationId
      })
    });
    
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    const responseText = await response.text();
    console.log(`📋 Response: ${responseText}`);
    
    results.push({ 
      test: 'Unauthorized User', 
      success: response.status === 403,
      status: response.status,
      response: responseText
    });
  } catch (error) {
    results.push({ 
      test: 'Unauthorized User', 
      success: false, 
      error: error.message 
    });
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.test}`);
    if (result.rowCount !== undefined) {
      console.log(`    📊 Exported ${result.rowCount} rows`);
    }
    if (result.error) {
      console.log(`    ❌ Error: ${result.error}`);
    }
  });
  
  const passCount = results.filter(r => r.success).length;
  console.log(`\n📈 Tests passed: ${passCount}/${results.length}`);
  
  return results;
}

// Run the tests
if (require.main === module) {
  runAllTests().then(results => {
    const allPassed = results.every(r => r.success);
    process.exit(allPassed ? 0 : 1);
  });
}

module.exports = { testExportOrgApps, runAllTests };
