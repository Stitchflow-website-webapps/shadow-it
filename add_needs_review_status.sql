-- Update the CHECK constraint to include "Needs review" status
-- First, drop the existing constraint
ALTER TABLE shadow_it.applications
  DROP CONSTRAINT IF EXISTS applications_management_status_check;

-- Add the new constraint with "Needs review" included
ALTER TABLE shadow_it.applications
  ADD CONSTRAINT applications_management_status_check CHECK (
    (
      management_status = any (
        array[
          'Managed'::text,
          'Unmanaged'::text,
          'Newly discovered'::text,
          'Needs review'::text
        ]
      )
    )
  );
