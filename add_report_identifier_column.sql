-- Add report_identifier column to notification_tracking table
-- This column will store report identifiers like 'weekly-apps-2025-26' or 'digest-users-2025-06-23'
-- for tracking digest/summary reports

ALTER TABLE shadow_it.notification_tracking 
ADD COLUMN IF NOT EXISTS report_identifier text;

-- Create index for better query performance on report_identifier
CREATE INDEX IF NOT EXISTS idx_notification_tracking_report_identifier 
ON shadow_it.notification_tracking(report_identifier);

-- Make application_id nullable since we'll use report_identifier for digest reports
ALTER TABLE shadow_it.notification_tracking 
ALTER COLUMN application_id DROP NOT NULL; 