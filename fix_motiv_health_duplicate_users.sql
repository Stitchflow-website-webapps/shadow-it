-- COMPREHENSIVE FIX: Remove duplicate users AND user_applications for Motiv Health
-- Organization ID: 74a6e8af-67f5-4cc3-b8e7-74ed3939f343

-- Step 1: Analyze the duplicate users problem
SELECT 
    'DUPLICATE USERS ANALYSIS' as analysis_type,
    COUNT(*) as total_users,
    COUNT(DISTINCT email) as unique_emails,
    COUNT(*) - COUNT(DISTINCT email) as duplicate_users
FROM shadow_it.users 
WHERE organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 2: Show specific duplicate users
SELECT 
    email,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ' ORDER BY created_at) as all_user_ids,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM shadow_it.users 
WHERE organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, email;

-- Step 3: Show how many user_applications will be affected
SELECT 
    'USER_APPLICATIONS IMPACT' as impact_type,
    COUNT(DISTINCT ua.id) as total_user_applications,
    COUNT(DISTINCT (u.email, a.name)) as unique_user_app_combinations,
    COUNT(DISTINCT ua.id) - COUNT(DISTINCT (u.email, a.name)) as excess_records
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.users u ON ua.user_id = u.id
INNER JOIN shadow_it.applications a ON ua.application_id = a.id
WHERE u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 4: CLEANUP - First remove user_applications for duplicate users
-- We'll keep user_applications only for the users we're going to keep
WITH users_to_keep AS (
    SELECT DISTINCT ON (email) 
        id,
        email
    FROM shadow_it.users 
    WHERE organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
    ORDER BY email, created_at ASC  -- Keep the oldest user for each email
),
user_applications_to_delete AS (
    SELECT ua.id
    FROM shadow_it.user_applications ua
    INNER JOIN shadow_it.users u ON ua.user_id = u.id
    WHERE u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
      AND u.id NOT IN (SELECT id FROM users_to_keep)
)
DELETE FROM shadow_it.user_applications
WHERE id IN (SELECT id FROM user_applications_to_delete);

-- Step 5: Now remove duplicate users (keeping the oldest for each email)
WITH users_to_delete AS (
    SELECT u.id
    FROM shadow_it.users u
    WHERE u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
      AND u.id NOT IN (
          SELECT DISTINCT ON (email) id
          FROM shadow_it.users 
          WHERE organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
          ORDER BY email, created_at ASC  -- Keep oldest user for each email
      )
)
DELETE FROM shadow_it.users
WHERE id IN (SELECT id FROM users_to_delete);

-- Step 6: Now clean up any remaining duplicate user_applications 
-- (in case the same user had multiple relationships to the same app)
WITH remaining_duplicates AS (
    SELECT 
        ua.id,
        ROW_NUMBER() OVER (
            PARTITION BY ua.user_id, ua.application_id 
            ORDER BY 
                COALESCE(array_length(ua.scopes, 1), 0) DESC,
                ua.created_at ASC
        ) as row_num
    FROM shadow_it.user_applications ua
    INNER JOIN shadow_it.users u ON ua.user_id = u.id
    WHERE u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343'
)
DELETE FROM shadow_it.user_applications 
WHERE id IN (
    SELECT id FROM remaining_duplicates WHERE row_num > 1
);

-- Step 7: Verify the cleanup worked
SELECT 
    'FINAL VERIFICATION - USERS' as verification_type,
    COUNT(*) as total_users,
    COUNT(DISTINCT email) as unique_emails,
    COUNT(*) - COUNT(DISTINCT email) as remaining_duplicate_users
FROM shadow_it.users 
WHERE organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

SELECT 
    'FINAL VERIFICATION - USER_APPLICATIONS' as verification_type,
    COUNT(*) as total_user_applications,
    COUNT(DISTINCT (ua.user_id, ua.application_id)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id)) as remaining_duplicates
FROM shadow_it.user_applications ua
INNER JOIN shadow_it.users u ON ua.user_id = u.id
WHERE u.organization_id = '74a6e8af-67f5-4cc3-b8e7-74ed3939f343';

-- Step 8: Add constraints to prevent future duplicates
ALTER TABLE shadow_it.users 
ADD CONSTRAINT IF NOT EXISTS users_unique_email_per_org 
UNIQUE (email, organization_id);

ALTER TABLE shadow_it.user_applications 
ADD CONSTRAINT IF NOT EXISTS user_application_unique_relationship 
UNIQUE (user_id, application_id);

-- Step 9: Final summary
SELECT 
    'CLEANUP SUMMARY' as summary,
    'Removed duplicate users and their cascading user_applications' as action_taken,
    'Added unique constraints to prevent future duplicates' as prevention_added;
