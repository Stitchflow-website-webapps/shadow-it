-- CORRECTED: Fix Motiv Health duplicate user_applications
-- The previous script had schema issues - this one is corrected for shadow_it schema

-- Step 1: Check current duplicates (what you're seeing now)
SELECT 
    'CURRENT STATE - Motiv Health duplicates' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT (ua.user_id, ua.application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id)) as duplicates_found
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 2: Show the actual duplicates (what you see in the dashboard)
SELECT 
    u.email,
    a.name as app_name,
    COUNT(*) as duplicate_count,
    STRING_AGG(ua.id::text, ', ' ORDER BY ua.created_at) as all_ids,
    MIN(ua.created_at) as first_created,
    MAX(ua.created_at) as last_created
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
GROUP BY ua.user_id, u.email, ua.application_id, a.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, u.email;

-- Step 3: MANUAL CLEANUP - Delete duplicates keeping the oldest record
-- This will delete the duplicate records you see in the dashboard
WITH duplicates_to_delete AS (
    SELECT 
        ua.id,
        ROW_NUMBER() OVER (
            PARTITION BY ua.user_id, ua.application_id 
            ORDER BY 
                COALESCE(array_length(ua.scopes, 1), 0) DESC,  -- Keep record with most scopes
                ua.created_at ASC                               -- If tied, keep oldest
        ) as row_num
    FROM shadow_it.user_applications ua
    INNER JOIN shadow_it.applications a ON ua.application_id = a.id
    INNER JOIN shadow_it.users u ON ua.user_id = u.id
    WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
      AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
)
DELETE FROM shadow_it.user_applications 
WHERE id IN (
    SELECT id FROM duplicates_to_delete WHERE row_num > 1
);

-- Step 4: Verify cleanup worked
SELECT 
    'AFTER CLEANUP - Motiv Health status' as status,
    COUNT(*) as total_records,
    COUNT(DISTINCT (ua.user_id, ua.application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id)) as remaining_duplicates
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 5: Add unique constraint to prevent this from happening again
ALTER TABLE shadow_it.user_applications 
ADD CONSTRAINT IF NOT EXISTS user_application_unique_relationship 
UNIQUE (user_id, application_id);
