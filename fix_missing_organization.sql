-- Fix missing organization ID error
-- This script will add the missing organization to the organizations table

-- First, check if the organization exists
-- If it doesn't exist, create it with a default name
INSERT INTO organizations (id, name, created_at, updated_at)
VALUES (
    'c98ce982-b9e1-4500-88bd-56b6c6141c27',
    'Default Organization',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verify the organization was created
SELECT id, name, created_at FROM organizations WHERE id = 'c98ce982-b9e1-4500-88bd-56b6c6141c27';