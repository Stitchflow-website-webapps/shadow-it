-- Migrate existing management_status values to new allowed statuses
-- This should be run BEFORE applying the new constraint

-- Update 'Not specified', 'Unknown', and 'Needs Review' to 'Newly discovered'
UPDATE shadow_it.applications 
SET management_status = 'Newly discovered' 
WHERE management_status IN ('Not specified', 'Unknown', 'Needs Review');

-- Update 'Ignore' to 'Unmanaged'
UPDATE shadow_it.applications 
SET management_status = 'Unmanaged' 
WHERE management_status = 'Ignore';

-- Show count of records updated
SELECT 
  management_status,
  COUNT(*) as count
FROM shadow_it.applications 
GROUP BY management_status 
ORDER BY management_status; 