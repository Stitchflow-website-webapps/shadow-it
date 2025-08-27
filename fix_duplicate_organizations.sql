-- Fix Duplicate Organizations in organize-app-inbox Schema
-- This script identifies and resolves duplicate organizations with the same shadow_org_id

-- Step 1: Identify duplicate organizations (including comma-separated scenarios)
WITH expanded_shadow_orgs AS (
    SELECT 
        id,
        name,
        domain,
        shadow_org_id,
        identity_provider,
        email_provider,
        created_at,
        updated_at,
        unnest(string_to_array(shadow_org_id, ',')) as individual_shadow_org_id
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id IS NOT NULL
)
SELECT 
    'DUPLICATE ORGANIZATIONS ANALYSIS' as analysis_type,
    COUNT(DISTINCT id) as total_organizations,
    COUNT(DISTINCT individual_shadow_org_id) as unique_individual_shadow_org_ids,
    COUNT(*) - COUNT(DISTINCT individual_shadow_org_id) as potential_duplicates
FROM expanded_shadow_orgs;

-- Step 2: Show specific duplicate organizations (including comma-separated scenarios)
WITH expanded_shadow_orgs AS (
    SELECT 
        id,
        name,
        domain,
        shadow_org_id,
        identity_provider,
        email_provider,
        created_at,
        updated_at,
        trim(unnest(string_to_array(shadow_org_id, ','))) as individual_shadow_org_id
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id IS NOT NULL
)
SELECT 
    individual_shadow_org_id,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ' ORDER BY created_at) as all_org_ids,
    STRING_AGG(name, ', ' ORDER BY created_at) as all_names,
    STRING_AGG(shadow_org_id, ', ' ORDER BY created_at) as all_full_shadow_org_ids,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM expanded_shadow_orgs
WHERE individual_shadow_org_id != ''
GROUP BY individual_shadow_org_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, individual_shadow_org_id;

-- Step 3: Show detailed information about the specific problematic shadow org ID
SELECT 
    'DETAILED ANALYSIS FOR: 06082830-06bf-4fb2-bfdd-d955ff996abc' as analysis,
    id,
    name,
    domain,
    shadow_org_id,
    identity_provider,
    email_provider,
    created_at,
    updated_at
FROM "organize-app-inbox".organizations 
WHERE shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
ORDER BY created_at;

-- Step 4: Check if any of these organizations have apps associated with them
SELECT 
    'APPS ASSOCIATED WITH DUPLICATE ORGS' as check_type,
    o.id as org_id,
    o.name as org_name,
    o.shadow_org_id,
    COUNT(a.id) as app_count
FROM "organize-app-inbox".organizations o
LEFT JOIN "organize-app-inbox".apps a ON o.id = a.org_id
WHERE o.shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
GROUP BY o.id, o.name, o.shadow_org_id
ORDER BY app_count DESC;

-- Step 5: MERGE STRATEGY - Keep the oldest organization and merge data
-- First, identify which organization to keep (the oldest one)
WITH organizations_to_merge AS (
    SELECT 
        id,
        name,
        domain,
        shadow_org_id,
        identity_provider,
        email_provider,
        created_at,
        updated_at,
        ROW_NUMBER() OVER (
            PARTITION BY shadow_org_id 
            ORDER BY created_at ASC
        ) as rn
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
),
org_to_keep AS (
    SELECT * FROM organizations_to_merge WHERE rn = 1
),
orgs_to_delete AS (
    SELECT * FROM organizations_to_merge WHERE rn > 1
)
SELECT 
    'ORGANIZATION TO KEEP' as action,
    id,
    name,
    shadow_org_id,
    created_at
FROM org_to_keep
UNION ALL
SELECT 
    'ORGANIZATIONS TO DELETE' as action,
    id,
    name,
    shadow_org_id,
    created_at
FROM orgs_to_delete;

-- Step 6: ACTUAL CLEANUP - Move apps from duplicate organizations to the primary one
-- This should be run carefully and tested first

-- First, let's see what would be moved:
WITH organizations_to_merge AS (
    SELECT 
        id,
        name,
        shadow_org_id,
        ROW_NUMBER() OVER (
            PARTITION BY shadow_org_id 
            ORDER BY created_at ASC
        ) as rn
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
),
org_to_keep AS (
    SELECT id FROM organizations_to_merge WHERE rn = 1
),
orgs_to_delete AS (
    SELECT id FROM organizations_to_merge WHERE rn > 1
)
SELECT 
    'APPS THAT WOULD BE MOVED' as action,
    a.id as app_id,
    a.name as app_name,
    a.org_id as current_org_id,
    (SELECT id FROM org_to_keep) as target_org_id
FROM "organize-app-inbox".apps a
WHERE a.org_id IN (SELECT id FROM orgs_to_delete);

-- Step 7: RECOMMENDATION - Manual cleanup steps
-- 1. Update apps to point to the primary organization
-- 2. Delete duplicate organizations
-- 3. Add unique constraint to prevent future duplicates

-- Here's the actual cleanup SQL (uncomment when ready to run):

/*
-- Step 7a: Move apps from duplicate organizations to the primary one
WITH organizations_to_merge AS (
    SELECT 
        id,
        shadow_org_id,
        ROW_NUMBER() OVER (
            PARTITION BY shadow_org_id 
            ORDER BY created_at ASC
        ) as rn
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
),
org_to_keep AS (
    SELECT id FROM organizations_to_merge WHERE rn = 1
),
orgs_to_delete AS (
    SELECT id FROM organizations_to_merge WHERE rn > 1
)
UPDATE "organize-app-inbox".apps 
SET org_id = (SELECT id FROM org_to_keep)
WHERE org_id IN (SELECT id FROM orgs_to_delete);

-- Step 7b: Delete duplicate organizations
WITH organizations_to_merge AS (
    SELECT 
        id,
        shadow_org_id,
        ROW_NUMBER() OVER (
            PARTITION BY shadow_org_id 
            ORDER BY created_at ASC
        ) as rn
    FROM "organize-app-inbox".organizations 
    WHERE shadow_org_id = '06082830-06bf-4fb2-bfdd-d955ff996abc'
)
DELETE FROM "organize-app-inbox".organizations 
WHERE id IN (
    SELECT id FROM organizations_to_merge WHERE rn > 1
);

-- Step 7c: Add unique constraint to prevent future duplicates
ALTER TABLE "organize-app-inbox".organizations 
ADD CONSTRAINT IF NOT EXISTS organizations_unique_shadow_org_id 
UNIQUE (shadow_org_id);
*/

-- Step 8: Verification after cleanup (run after cleanup)
SELECT 
    'VERIFICATION AFTER CLEANUP' as verification,
    COUNT(*) as total_organizations,
    COUNT(DISTINCT shadow_org_id) as unique_shadow_org_ids,
    COUNT(*) - COUNT(DISTINCT shadow_org_id) as remaining_duplicates
FROM "organize-app-inbox".organizations 
WHERE shadow_org_id IS NOT NULL;
