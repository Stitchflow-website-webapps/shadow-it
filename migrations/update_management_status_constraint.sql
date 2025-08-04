-- Update management_status constraint to only allow 3 statuses
-- Remove old constraint and add new one

-- First, drop the existing constraint
ALTER TABLE shadow_it.applications
  DROP CONSTRAINT IF EXISTS applications_management_status_check;

-- Add new constraint with only 3 allowed statuses
ALTER TABLE shadow_it.applications
  ADD CONSTRAINT applications_management_status_check CHECK (
    (
      management_status = any (
        array[
          'Managed'::text,
          'Unmanaged'::text,
          'Newly discovered'::text
        ]
      )
    )
  ); 