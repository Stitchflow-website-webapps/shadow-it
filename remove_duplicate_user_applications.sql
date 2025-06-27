-- Function to remove duplicate user_applications after merging applications
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
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql; 