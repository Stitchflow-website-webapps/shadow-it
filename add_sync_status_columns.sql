-- Migration to add missing columns to sync_status table
-- Run this on existing databases to add scope, token_expiry, and provider columns

ALTER TABLE sync_status 
ADD COLUMN IF NOT EXISTS scope TEXT,
ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'google';

-- Add index on provider and scope for better query performance
CREATE INDEX IF NOT EXISTS idx_sync_status_provider ON sync_status(provider);
CREATE INDEX IF NOT EXISTS idx_sync_status_scope ON sync_status(scope) WHERE scope IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_status_org_user ON sync_status(organization_id, user_email); 