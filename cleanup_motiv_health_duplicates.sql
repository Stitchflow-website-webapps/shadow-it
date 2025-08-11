-- Cleanup script for Motiv Health duplicate user_applications
-- Organization ID: 74a6e8af-67f5-4cc3-b8e7-74ed3939f343
-- This script will remove duplicate user-application relationships caused by multiple sync runs

-- First, let's check how many duplicates exist
SELECT 
    'Before cleanup - Total user_applications for Motiv Health' as description,
    COUNT(*) as count
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Check for actual duplicates (same user_id + application_id combination)
SELECT 
    'Duplicate user-app combinations' as description,
    COUNT(*) as total_records,
    COUNT(DISTINCT (user_id, application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (user_id, application_id)) as duplicates
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Show specific duplicates with details
SELECT 
    ua.user_id,
    u.email,
    ua.application_id,
    a.name as app_name,
    COUNT(*) as duplicate_count,
    STRING_AGG(ua.id::text, ', ') as duplicate_ids,
    STRING_AGG(COALESCE(array_length(ua.scopes, 1), 0)::text, ', ') as scope_counts
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
GROUP BY ua.user_id, u.email, ua.application_id, a.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, u.email, a.name;

-- Execute the cleanup using the existing function
SELECT remove_duplicate_user_applications('74a6e8af-67f5-4cc3-b8e7-74ed3939f343'::UUID) as deleted_count;

-- Verify cleanup - check totals after
SELECT 
    'After cleanup - Total user_applications for Motiv Health' as description,
    COUNT(*) as count
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Verify no duplicates remain
SELECT 
    'Remaining duplicates after cleanup' as description,
    COUNT(*) as total_records,
    COUNT(DISTINCT (user_id, application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (user_id, application_id)) as remaining_duplicates
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Optional: Show final state of user-app relationships
SELECT 
    u.email,
    a.name as app_name,
    ua.scopes,
    ua.created_at,
    ua.updated_at
FROM user_applications ua
INNER JOIN applications a ON ua.application_id = a.id
INNER JOIN users u ON ua.user_id = u.id
WHERE a.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
  AND u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
ORDER BY u.email, a.name;
