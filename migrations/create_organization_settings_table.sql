-- Create organization_settings table for storing AI risk calculation settings per organization
CREATE TABLE IF NOT EXISTS shadow_it.organization_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bucket_weights jsonb NOT NULL DEFAULT '{
    "dataPrivacy": 20,
    "securityAccess": 25,
    "businessImpact": 20,
    "aiGovernance": 20,
    "vendorProfile": 15
  }'::jsonb,
  ai_multipliers jsonb NOT NULL DEFAULT '{
    "native": {
      "dataPrivacy": 1.5,
      "securityAccess": 1.4,
      "businessImpact": 1.3,
      "aiGovernance": 1.6,
      "vendorProfile": 1.2
    },
    "partial": {
      "dataPrivacy": 1.2,
      "securityAccess": 1.1,
      "businessImpact": 1.1,
      "aiGovernance": 1.3,
      "vendorProfile": 1.0
    },
    "none": {
      "dataPrivacy": 1.0,
      "securityAccess": 1.0,
      "businessImpact": 1.0,
      "aiGovernance": 1.0,
      "vendorProfile": 1.0
    }
  }'::jsonb,
  scope_multipliers jsonb NOT NULL DEFAULT '{
    "high": {
      "dataPrivacy": 1.4,
      "securityAccess": 1.5,
      "businessImpact": 1.3,
      "aiGovernance": 1.2,
      "vendorProfile": 1.1
    },
    "medium": {
      "dataPrivacy": 1.2,
      "securityAccess": 1.2,
      "businessImpact": 1.1,
      "aiGovernance": 1.1,
      "vendorProfile": 1.0
    },
    "low": {
      "dataPrivacy": 1.0,
      "securityAccess": 1.0,
      "businessImpact": 1.0,
      "aiGovernance": 1.0,
      "vendorProfile": 1.0
    }
  }'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organization_settings_pkey PRIMARY KEY (id),
  CONSTRAINT organization_settings_organization_id_key UNIQUE (organization_id),
  CONSTRAINT organization_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) TABLESPACE pg_default;

-- Add RLS policies for organization_settings table
ALTER TABLE shadow_it.organization_settings ENABLE ROW LEVEL SECURITY;

-- Allow users to read settings for their organization
CREATE POLICY "Allow read for organization members" ON shadow_it.organization_settings
    FOR SELECT USING (true);

-- Allow admin users to insert/update settings for their organization
CREATE POLICY "Allow insert for organization settings" ON shadow_it.organization_settings
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update for organization settings" ON shadow_it.organization_settings
    FOR UPDATE USING (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_organization_settings_organization_id 
ON shadow_it.organization_settings USING btree (organization_id) TABLESPACE pg_default;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION shadow_it.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organization_settings_updated_at BEFORE UPDATE
    ON shadow_it.organization_settings FOR EACH ROW EXECUTE FUNCTION
    shadow_it.update_updated_at_column(); 