#!/usr/bin/env node

/**
 * Script to compare all cleanup approaches
 */

async function compareCleanupApproaches(orgId) {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Comparing Cleanup Approaches');
  console.log('================================\n');
  
  const approaches = [
    {
      name: 'Fast Pattern-Based',
      endpoint: '/api/admin/cleanup-microsoft-user-apps-fast',
      description: 'Database pattern analysis only'
    },
    {
      name: 'Targeted Smart',
      endpoint: '/api/admin/cleanup-microsoft-user-apps-targeted', 
      description: 'Smart sampling of suspicious apps'
    },
    {
      name: 'Comprehensive (Fixed)',
      endpoint: '/api/admin/cleanup-microsoft-user-apps',
      description: 'Full Microsoft API verification (members only)'
    }
  ];
  
  for (const approach of approaches) {
    console.log(`⚡ Testing: ${approach.name}`);
    console.log(`📝 ${approach.description}`);
    console.log('─'.repeat(50));
    
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
      
      const response = await fetch(`${baseUrl}${approach.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          dry_run: true
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      
      if (response.ok) {
        const result = await response.json();
        
        console.log(`✅ ${approach.name} completed in ${duration}ms`);
        console.log(`📊 Analysis method: ${result.analysis.method || 'standard'}`);
        console.log(`📈 Total relationships: ${result.analysis.totalRelationships}`);
        console.log(`🔍 Relationships to remove: ${result.analysis.relationshipsToRemove}`);
        console.log(`✅ Relationships to keep: ${result.analysis.relationshipsToKeep}`);
        
        if (result.analysis.suspiciousApps !== undefined) {
          console.log(`🚨 Suspicious apps: ${result.analysis.suspiciousApps}`);
        }
        
        if (result.suspiciousApplications?.length > 0) {
          console.log(`📱 Top suspicious apps:`);
          result.suspiciousApplications.slice(0, 3).forEach(app => {
            console.log(`   ${app.name}: ${app.userCount} users (${app.percentageOfOrg}%)`);
          });
        }
        
        console.log(`💡 Recommendation: ${result.recommendation}`);
        
      } else {
        const error = await response.json();
        console.log(`❌ ${approach.name} failed: ${error.error}`);
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error.name === 'AbortError') {
        console.log(`⏰ ${approach.name} timed out after ${duration}ms`);
      } else {
        console.log(`❌ ${approach.name} error: ${error.message}`);
      }
    }
    
    console.log('\n');
  }
  
  console.log('🎯 Recommendations:');
  console.log('1. Use FAST for quick analysis and pattern-based cleanup');
  console.log('2. Use TARGETED for smart verification with minimal API calls');
  console.log('3. Use COMPREHENSIVE only when you need full Microsoft API validation');
  console.log('4. For admin consent issues, FAST is usually sufficient');
}

async function main() {
  const orgId = process.argv[2];
  
  if (!orgId) {
    console.error('❌ Usage: node scripts/compare-cleanup-approaches.js <organization_id>');
    console.log('\nExample:');
    console.log('  node scripts/compare-cleanup-approaches.js a090212d-b499-4225-95f9-91ed24aa0dc1');
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
  
  await compareCleanupApproaches(orgId);
}

main().catch(console.error);
