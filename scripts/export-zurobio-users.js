#!/usr/bin/env node

/**
 * Script to export Zurobio users to CSV files
 */

const fs = require('fs');
const path = require('path');

async function exportUsersToCSV() {
  const baseUrl = 'http://localhost:3000';
  const orgId = 'a090212d-b499-4225-95f9-91ed24aa0dc1';
  
  console.log('🔍 Fetching user data from Microsoft filtering API...');
  
  try {
    const response = await fetch(`${baseUrl}/api/test-microsoft-filtering?org_id=${orgId}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('✅ Data fetched successfully');
    console.log(`📊 Found ${data.detailedAnalysis.members.count} active members and ${data.detailedAnalysis.guests.count} guests`);
    
    // Create CSV content for active members
    const membersCSV = [
      'Email,Display Name,Account Enabled,User Type',
      ...data.detailedAnalysis.members.emails.map(user => 
        `"${user.email}","${user.displayName}","${user.accountEnabled}","Member"`
      )
    ].join('\n');
    
    // Create CSV content for guests
    const guestsCSV = [
      'Email,Display Name,Account Enabled,User Type',
      ...data.detailedAnalysis.guests.emails.map(user => 
        `"${user.email}","${user.displayName}","${user.accountEnabled}","Guest"`
      )
    ].join('\n');
    
    // Create combined CSV
    const combinedCSV = [
      'Email,Display Name,Account Enabled,User Type',
      ...data.detailedAnalysis.members.emails.map(user => 
        `"${user.email}","${user.displayName}","${user.accountEnabled}","Member"`
      ),
      ...data.detailedAnalysis.guests.emails.map(user => 
        `"${user.email}","${user.displayName}","${user.accountEnabled}","Guest"`
      )
    ].join('\n');
    
    // Write files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const membersFile = `zurobio-active-members-${timestamp}.csv`;
    const guestsFile = `zurobio-guests-${timestamp}.csv`;
    const combinedFile = `zurobio-all-users-${timestamp}.csv`;
    
    fs.writeFileSync(membersFile, membersCSV);
    fs.writeFileSync(guestsFile, guestsCSV);
    fs.writeFileSync(combinedFile, combinedCSV);
    
    console.log('📁 Files created:');
    console.log(`   ✅ ${membersFile} (${data.detailedAnalysis.members.count} active members)`);
    console.log(`   ✅ ${guestsFile} (${data.detailedAnalysis.guests.count} guests)`);
    console.log(`   ✅ ${combinedFile} (${data.detailedAnalysis.members.count + data.detailedAnalysis.guests.count} total users)`);
    
    // Show summary
    console.log('\n📊 Summary:');
    console.log(`   👥 Active Members: ${data.detailedAnalysis.members.count}`);
    console.log(`   🚪 Guests: ${data.detailedAnalysis.guests.count}`);
    console.log(`   📊 Total: ${data.detailedAnalysis.members.count + data.detailedAnalysis.guests.count}`);
    console.log(`   🎯 Current sync includes: ${data.testResults.membersOnly.count} users (active members only)`);
    
    // Show sample data
    console.log('\n📋 Sample Active Members:');
    data.detailedAnalysis.members.emails.slice(0, 5).forEach(user => {
      console.log(`   ${user.email} - ${user.displayName}`);
    });
    
    console.log('\n📋 Sample Guests:');
    data.detailedAnalysis.guests.emails.slice(0, 5).forEach(user => {
      console.log(`   ${user.email} - ${user.displayName}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    await fetch('http://localhost:3000/api/test-microsoft-filtering?org_id=test');
  } catch (error) {
    console.error('❌ Development server is not running!');
    console.log('\n💡 Start the server first:');
    console.log('   npm run dev');
    process.exit(1);
  }
}

async function main() {
  await checkServer();
  await exportUsersToCSV();
}

main().catch(console.error);
