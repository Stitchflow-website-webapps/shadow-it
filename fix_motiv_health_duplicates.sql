-- Fix Motiv Health duplicate user_applications
-- Organization ID: 74a6e8af-67f5-4cc3-b8e7-74ed3939f343
-- This script will create the cleanup function and execute it for Motiv Health

-- Step 1: Create the cleanup function for shadow_it schema
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

-- Step 2: Check current state before cleanup
SELECT 
    'Before cleanup - Motiv Health user_applications' as description,
    COUNT(*) as total_records,
    COUNT(DISTINCT (ua.user_id, ua.application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id)) as duplicates
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 3: Show sample duplicates (top 10)
SELECT 
    u.email,
    a.name as app_name,
    COUNT(*) as duplicate_count,
    STRING_AGG(ua.id::text, ', ') as duplicate_ids
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
GROUP BY ua.user_id, u.email, ua.application_id, a.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, u.email, a.name
LIMIT 10;

-- Step 4: Execute the cleanup
SELECT 
    'Cleanup result' as description,
    remove_duplicate_user_applications('74a6e8af-67f5-4cc3-b8e7-74ed3939f343'::UUID) as deleted_count;

-- Step 5: Verify cleanup worked
SELECT 
    'After cleanup - Motiv Health user_applications' as description,
    COUNT(*) as total_records,
    COUNT(DISTINCT (ua.user_id, ua.application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id)) as remaining_duplicates
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 6: Add unique constraint to prevent future duplicates (optional)
-- Uncomment the next line if you want to prevent future duplicates
-- ALTER TABLE shadow_it.user_applications ADD CONSTRAINT user_application_unique_relationship UNIQUE (user_id, application_id);
