#!/usr/bin/env node

/**
 * Performance Testing Script for Applications API
 * 
 * This script tests both the old (/api/applications) and new (/api/applications-v2)
 * endpoints to measure performance improvements.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ORG_ID = process.env.TEST_ORG_ID;

if (!ORG_ID) {
  console.error('❌ Please set TEST_ORG_ID environment variable');
  console.error('   Example: TEST_ORG_ID=354c2aee-f32e-44b8-b820-9e393ff690b9 node scripts/test-performance.js');
  process.exit(1);
}

async function testEndpoint(url, name) {
  console.log(`\n🔍 Testing ${name}...`);
  console.log(`   URL: ${url}`);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const responseTime = data.responseTime || totalTime;
    
    console.log(`   ✅ Status: ${response.status}`);
    console.log(`   ⏱️  Total Time: ${totalTime}ms`);
    console.log(`   🎯 Server Time: ${responseTime}ms`);
    console.log(`   📊 Applications: ${Array.isArray(data) ? data.length : (data.applications?.length || 0)}`);
    
    if (data.fromCache !== undefined) {
      console.log(`   💾 From Cache: ${data.fromCache ? 'Yes' : 'No'}`);
    }
    
    if (data.metadata) {
      console.log(`   📄 Page: ${data.metadata.page || 1}, Limit: ${data.metadata.limit || 'N/A'}`);
      console.log(`   🔄 Has More: ${data.metadata.hasMore ? 'Yes' : 'No'}`);
    }
    
    return {
      success: true,
      totalTime,
      serverTime: responseTime,
      applications: Array.isArray(data) ? data.length : (data.applications?.length || 0),
      fromCache: data.fromCache,
      data
    };
    
  } catch (error) {
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    console.log(`   ❌ Error: ${error.message}`);
    console.log(`   ⏱️  Time to Error: ${totalTime}ms`);
    
    return {
      success: false,
      totalTime,
      error: error.message
    };
  }
}

async function runPerformanceTests() {
  console.log('🚀 Applications API Performance Test');
  console.log('=====================================');
  console.log(`Organization ID: ${ORG_ID}`);
  console.log(`Base URL: ${BASE_URL}`);
  
  // Test old endpoint
  const oldResult = await testEndpoint(
    `${BASE_URL}/api/applications?orgId=${ORG_ID}`,
    'OLD Endpoint (/api/applications)'
  );
  
  // Test new endpoint (first call - no cache)
  const newResult = await testEndpoint(
    `${BASE_URL}/api/applications-v2?orgId=${ORG_ID}&limit=50`,
    'NEW Endpoint (/api/applications-v2) - First Call'
  );
  
  // Test new endpoint (second call - should be cached)
  const newCachedResult = await testEndpoint(
    `${BASE_URL}/api/applications-v2?orgId=${ORG_ID}&limit=50`,
    'NEW Endpoint (/api/applications-v2) - Cached Call'
  );
  
  // Test user details endpoint (lazy loading)
  let userDetailsResult = null;
  if (newResult.success && newResult.data?.applications?.length > 0) {
    const testApp = newResult.data.applications[0];
    userDetailsResult = await testEndpoint(
      `${BASE_URL}/api/application-users?appId=${testApp.id}&orgId=${ORG_ID}`,
      'User Details Endpoint (Lazy Loading)'
    );
  }
  
  // Performance Summary
  console.log('\n📊 PERFORMANCE SUMMARY');
  console.log('======================');
  
  if (oldResult.success && newResult.success) {
    const improvement = ((oldResult.totalTime - newResult.totalTime) / oldResult.totalTime * 100).toFixed(1);
    const serverImprovement = ((oldResult.serverTime - newResult.serverTime) / oldResult.serverTime * 100).toFixed(1);
    
    console.log(`\n🏆 Speed Improvement:`);
    console.log(`   Total Time: ${improvement > 0 ? '+' : ''}${improvement}% (${oldResult.totalTime}ms → ${newResult.totalTime}ms)`);
    console.log(`   Server Time: ${serverImprovement > 0 ? '+' : ''}${serverImprovement}% (${oldResult.serverTime}ms → ${newResult.serverTime}ms)`);
    
    if (newCachedResult.success && newCachedResult.fromCache) {
      const cacheImprovement = ((oldResult.totalTime - newCachedResult.totalTime) / oldResult.totalTime * 100).toFixed(1);
      console.log(`   With Cache: +${cacheImprovement}% (${oldResult.totalTime}ms → ${newCachedResult.totalTime}ms)`);
    }
    
    console.log(`\n📈 Data Consistency:`);
    console.log(`   Old Apps: ${oldResult.applications}`);
    console.log(`   New Apps: ${newResult.applications}`);
    console.log(`   Difference: ${Math.abs(oldResult.applications - newResult.applications)} apps`);
    
  } else {
    console.log('\n⚠️  Cannot compare performance due to errors');
    if (!oldResult.success) console.log(`   Old endpoint failed: ${oldResult.error}`);
    if (!newResult.success) console.log(`   New endpoint failed: ${newResult.error}`);
  }
  
  if (userDetailsResult) {
    console.log(`\n🔍 User Details Performance:`);
    console.log(`   Load Time: ${userDetailsResult.totalTime}ms`);
    console.log(`   Users Loaded: ${userDetailsResult.success ? 'Success' : 'Failed'}`);
  }
  
  console.log('\n✨ Test Complete!');
  
  // Return results for programmatic use
  return {
    old: oldResult,
    new: newResult,
    newCached: newCachedResult,
    userDetails: userDetailsResult
  };
}

// Run tests if called directly
if (require.main === module) {
  runPerformanceTests()
    .then(results => {
      // Exit with appropriate code
      const success = results.old.success && results.new.success;
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { runPerformanceTests, testEndpoint }; 