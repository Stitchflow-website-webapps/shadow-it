-- Prevent future duplicate user_applications by adding/ensuring unique constraint
-- This should be run after cleaning up existing duplicates

-- First, check if the unique constraint already exists
SELECT 
    constraint_name, 
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_name = 'user_applications' 
  AND constraint_type = 'UNIQUE'
  AND constraint_name LIKE '%user%application%';

-- If the constraint doesn't exist, add it
-- Note: This will fail if there are still duplicates, so run cleanup first
DO $$
BEGIN
    -- Check if constraint exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'user_applications' 
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'user_application_unique_relationship'
    ) THEN
        -- Add the unique constraint
        ALTER TABLE user_applications
        ADD CONSTRAINT user_application_unique_relationship UNIQUE (user_id, application_id);
        
        RAISE NOTICE 'Added unique constraint user_application_unique_relationship';
    ELSE
        RAISE NOTICE 'Unique constraint user_application_unique_relationship already exists';
    END IF;
END $$;

-- Create or replace an improved cleanup function that handles edge cases better
CREATE OR REPLACE FUNCTION remove_duplicate_user_applications_improved(org_id UUID)
RETURNS TABLE(
    deleted_count INTEGER,
    summary TEXT
) AS $$
DECLARE
    deleted_count INTEGER := 0;
    duplicate_count INTEGER := 0;
BEGIN
    -- First, count how many duplicates exist
    SELECT COUNT(*) - COUNT(DISTINCT (ua.user_id, ua.application_id))
    INTO duplicate_count
    FROM user_applications ua
    INNER JOIN applications a ON ua.application_id = a.id
    INNER JOIN users u ON ua.user_id = u.id
    WHERE a.organization_id = org_id
      AND u.organization_id = org_id;
    
    IF duplicate_count = 0 THEN
        RETURN QUERY SELECT 0, 'No duplicates found for organization ' || org_id::text;
        RETURN;
    END IF;
    
    -- Remove duplicates, keeping the one with:
    -- 1. Most scopes (most permissions = most complete record)
    -- 2. If tied on scopes, keep the earliest created (original record)
    -- 3. If still tied, keep the one with latest updated_at (most recent data)
    WITH duplicates AS (
        SELECT 
            ua.id,
            ua.user_id,
            ua.application_id,
            ua.scopes,
            ua.created_at,
            ua.updated_at,
            ROW_NUMBER() OVER (
                PARTITION BY ua.user_id, ua.application_id 
                ORDER BY 
                    COALESCE(array_length(ua.scopes, 1), 0) DESC,  -- Most scopes first
                    ua.created_at ASC,                              -- Earliest created first
                    ua.updated_at DESC                              -- Latest updated first
            ) as rn
        FROM user_applications ua
        INNER JOIN applications a ON ua.application_id = a.id
        INNER JOIN users u ON ua.user_id = u.id
        WHERE a.organization_id = org_id
          AND u.organization_id = org_id
    ),
    duplicates_to_delete AS (
        SELECT id FROM duplicates WHERE rn > 1
    )
    DELETE FROM user_applications 
    WHERE id IN (SELECT id FROM duplicates_to_delete);
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN QUERY SELECT 
        deleted_count, 
        'Removed ' || deleted_count::text || ' duplicate records out of ' || duplicate_count::text || ' total duplicates for organization ' || org_id::text;
END;
$$ LANGUAGE plpgsql;

-- Create a function to check for duplicates across all organizations
CREATE OR REPLACE FUNCTION check_all_organizations_for_duplicates()
RETURNS TABLE(
    organization_id UUID,
    organization_name TEXT,
    domain TEXT,
    total_user_apps INTEGER,
    unique_combinations INTEGER,
    duplicate_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id as organization_id,
        o.name as organization_name,
        o.domain,
        COUNT(ua.id)::INTEGER as total_user_apps,
        COUNT(DISTINCT (ua.user_id, ua.application_id))::INTEGER as unique_combinations,
        (COUNT(ua.id) - COUNT(DISTINCT (ua.user_id, ua.application_id)))::INTEGER as duplicate_count
    FROM organizations o
    LEFT JOIN applications a ON a.organization_id = o.id
    LEFT JOIN user_applications ua ON ua.application_id = a.id
    LEFT JOIN users u ON ua.user_id = u.id AND u.organization_id = o.id
    WHERE ua.id IS NOT NULL  -- Only include orgs with user_applications
    GROUP BY o.id, o.name, o.domain
    HAVING COUNT(ua.id) > COUNT(DISTINCT (ua.user_id, ua.application_id))
    ORDER BY duplicate_count DESC;
END;
$$ LANGUAGE plpgsql;
