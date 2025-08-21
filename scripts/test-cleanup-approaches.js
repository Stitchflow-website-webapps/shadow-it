#!/usr/bin/env node

/**
 * Script to test both cleanup approaches - fast vs comprehensive
 */

async function testCleanupApproaches(orgId) {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Testing Cleanup Approaches');
  console.log('============================\n');
  
  // Test 1: Fast cleanup approach
  console.log('⚡ Test 1: Fast Pattern-Based Cleanup');
  console.log('------------------------------------');
  
  const startTime1 = Date.now();
  
  try {
    const response1 = await fetch(`${baseUrl}/api/admin/cleanup-microsoft-user-apps-fast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId,
        dry_run: true
      })
    });
    
    const result1 = await response1.json();
    const duration1 = Date.now() - startTime1;
    
    if (response1.ok) {
      console.log(`✅ Fast cleanup completed in ${duration1}ms`);
      console.log(`📊 Results:`);
      console.log(`   Total relationships: ${result1.analysis.totalRelationships}`);
      console.log(`   Suspicious apps: ${result1.analysis.suspiciousApps}`);
      console.log(`   Normal apps: ${result1.analysis.normalApps}`);
      console.log(`   Relationships to remove: ${result1.analysis.relationshipsToRemove}`);
      console.log(`   Method: ${result1.analysis.method}`);
      
      if (result1.suspiciousApplications?.length > 0) {
        console.log(`\n🚨 Suspicious Applications:`);
        result1.suspiciousApplications.forEach(app => {
          console.log(`   ${app.name}: ${app.userCount} users (${app.percentageOfOrg}%)`);
        });
      }
    } else {
      console.error('❌ Fast cleanup failed:', result1);
    }
  } catch (error) {
    console.error('❌ Fast cleanup error:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: Comprehensive cleanup approach (but with timeout)
  console.log('🔍 Test 2: Comprehensive Microsoft API Cleanup');
  console.log('----------------------------------------------');
  console.log('⚠️  Note: This may take several minutes...');
  
  const startTime2 = Date.now();
  
  try {
    // Set a reasonable timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
    
    const response2 = await fetch(`${baseUrl}/api/admin/cleanup-microsoft-user-apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: orgId,
        dry_run: true
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const result2 = await response2.json();
    const duration2 = Date.now() - startTime2;
    
    if (response2.ok) {
      console.log(`✅ Comprehensive cleanup completed in ${duration2}ms`);
      console.log(`📊 Results:`);
      console.log(`   Total relationships: ${result2.analysis.totalRelationships}`);
      console.log(`   Relationships to keep: ${result2.analysis.relationshipsToKeep}`);
      console.log(`   Relationships to remove: ${result2.analysis.relationshipsToRemove}`);
      console.log(`   Users with actual assignments: ${result2.analysis.actualAssignments}`);
      
      if (result2.applicationBreakdown) {
        console.log(`\n📱 Application breakdown:`);
        Object.entries(result2.applicationBreakdown).forEach(([appName, counts]) => {
          console.log(`   ${appName}: Keep ${counts.keep}, Remove ${counts.remove}`);
        });
      }
    } else {
      console.error('❌ Comprehensive cleanup failed:', result2);
    }
  } catch (error) {
    const duration2 = Date.now() - startTime2;
    if (error.name === 'AbortError') {
      console.error(`❌ Comprehensive cleanup timed out after ${duration2}ms`);
    } else {
      console.error('❌ Comprehensive cleanup error:', error.message);
    }
  }
  
  console.log('\n🎯 Recommendations:');
  console.log('1. Use FAST cleanup for quick analysis and pattern-based removal');
  console.log('2. Use COMPREHENSIVE cleanup only when you need Microsoft API validation');
  console.log('3. Fast cleanup is usually sufficient for admin consent issues');
}

async function main() {
  const orgId = process.argv[2];
  
  if (!orgId) {
    console.error('❌ Usage: node scripts/test-cleanup-approaches.js <organization_id>');
    console.log('\nExample:');
    console.log('  node scripts/test-cleanup-approaches.js a090212d-b499-4225-95f9-91ed24aa0dc1');
    process.exit(1);
  }
  
  // Check if server is running
  try {
    await fetch('http://localhost:3000/api/admin/cleanup-microsoft-user-apps-fast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: 'test' })
    });
  } catch (error) {
    console.error('❌ Development server is not running!');
    console.log('\n💡 Start the server first:');
    console.log('   npm run dev');
    process.exit(1);
  }
  
  await testCleanupApproaches(orgId);
}

main().catch(console.error);
