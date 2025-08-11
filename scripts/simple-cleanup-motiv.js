#!/usr/bin/env node

/**
 * Simple script to clean up Motiv Health duplicates using the existing SQL function
 * Run with: node scripts/simple-cleanup-motiv.js
 */

const { supabaseAdmin } = require('../lib/supabase.ts');

const MOTIV_HEALTH_ORG_ID = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

async function main() {
  // Use the existing supabaseAdmin client from lib/supabase.ts
  const supabase = supabaseAdmin;

  console.log('🧹 Cleaning up Motiv Health duplicates...');
  console.log(`Organization ID: ${MOTIV_HEALTH_ORG_ID}`);

  try {
    // Execute cleanup using the existing function
    console.log('\n🔍 Running cleanup function...');
    const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
      'remove_duplicate_user_applications', 
      { org_id: MOTIV_HEALTH_ORG_ID }
    );

    if (cleanupError) {
      console.error('❌ Error during cleanup:', cleanupError);
      
      // If the function doesn't exist, provide instructions
      if (cleanupError.code === 'PGRST202') {
        console.log('\n📝 The cleanup function is missing. Please run this SQL first:');
        console.log('\n' + `
-- Create the cleanup function
CREATE OR REPLACE FUNCTION remove_duplicate_user_applications(org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
BEGIN
    -- Remove duplicate user_applications, keeping the one with the most scopes
    WITH duplicates AS (
        SELECT 
            ua.id,
            ua.user_id,
            ua.application_id,
            ua.scopes,
            ROW_NUMBER() OVER (
                PARTITION BY ua.user_id, ua.application_id 
                ORDER BY 
                    COALESCE(array_length(ua.scopes, 1), 0) DESC,
                    ua.created_at ASC
            ) as rn
        FROM shadow_it.user_applications ua
        INNER JOIN shadow_it.applications a ON ua.application_id = a.id
        INNER JOIN shadow_it.users u ON ua.user_id = u.id
        WHERE a.organization_id = org_id
          AND u.organization_id = org_id
    ),
    duplicates_to_delete AS (
        SELECT id FROM duplicates WHERE rn > 1
    )
    DELETE FROM shadow_it.user_applications 
    WHERE id IN (SELECT id FROM duplicates_to_delete);
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Then run the cleanup
SELECT remove_duplicate_user_applications('${MOTIV_HEALTH_ORG_ID}'::UUID);
        `.trim());
      }
      return;
    }

    console.log(`✅ Cleanup completed! Removed ${cleanupResult} duplicate records.`);

    if (cleanupResult > 0) {
      console.log('🎉 SUCCESS: Duplicates have been removed!');
    } else {
      console.log('ℹ️  No duplicates were found to remove.');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
