-- Migration to add new fields and rename existing fields in organize-app-inbox.apps table
-- Run this script to update your existing table structure

-- First, add all the new columns
ALTER TABLE "organize-app-inbox".apps 
ADD COLUMN renewal_type text null, -- Auto Renewal, Manual Renewal, Perpetual Renewal
ADD COLUMN billing_owner text null, -- Short text field for license/paying person details
ADD COLUMN purchase_category text null, -- Software, Services, Add-on, Infrastructure, Hardware, Others
ADD COLUMN opt_out_date text null, -- Calendar date for opt-out deadline
ADD COLUMN opt_out_period integer null, -- Number of days for opt-out period
ADD COLUMN vendor_contract_status text null, -- Active, Inactive
ADD COLUMN payment_method text null, -- Company Credit Card, E-Check, Wire, Accounts Payable
ADD COLUMN payment_terms text null, -- Net 30, Due Upon Receipt, 2/10 Net 30, Partial Payment
ADD COLUMN budget_source text null; -- Text field for budget source

-- Rename existing columns
ALTER TABLE "organize-app-inbox".apps 
RENAME COLUMN owner TO technical_owner;

ALTER TABLE "organize-app-inbox".apps 
RENAME COLUMN app_plan TO billing_frequency;

-- Add indexes for the new fields that might be frequently queried
CREATE INDEX IF NOT EXISTS idx_apps_renewal_type ON "organize-app-inbox".apps USING btree (renewal_type) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_purchase_category ON "organize-app-inbox".apps USING btree (purchase_category) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_vendor_contract_status ON "organize-app-inbox".apps USING btree (vendor_contract_status) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_payment_method ON "organize-app-inbox".apps USING btree (payment_method) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_opt_out_date ON "organize-app-inbox".apps USING btree (opt_out_date) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_technical_owner ON "organize-app-inbox".apps USING btree (technical_owner) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_apps_billing_frequency ON "organize-app-inbox".apps USING btree (billing_frequency) TABLESPACE pg_default;

-- Optional: Add comments to document the new fields
COMMENT ON COLUMN "organize-app-inbox".apps.renewal_type IS 'Type of renewal: Auto Renewal, Manual Renewal, Perpetual Renewal';
COMMENT ON COLUMN "organize-app-inbox".apps.billing_owner IS 'Person responsible for billing/payment';
COMMENT ON COLUMN "organize-app-inbox".apps.purchase_category IS 'Category: Software, Services, Add-on, Infrastructure, Hardware, Others';
COMMENT ON COLUMN "organize-app-inbox".apps.opt_out_date IS 'Deadline date for opting out of renewal';
COMMENT ON COLUMN "organize-app-inbox".apps.opt_out_period IS 'Number of days allowed for opt-out period';
COMMENT ON COLUMN "organize-app-inbox".apps.vendor_contract_status IS 'Contract status: Active, Inactive';
COMMENT ON COLUMN "organize-app-inbox".apps.payment_method IS 'Payment method: Company Credit Card, E-Check, Wire, Accounts Payable';
COMMENT ON COLUMN "organize-app-inbox".apps.payment_terms IS 'Payment terms: Net 30, Due Upon Receipt, 2/10 Net 30, Partial Payment';
COMMENT ON COLUMN "organize-app-inbox".apps.budget_source IS 'Source of budget (e.g., Legal, Finance, Tech)';
COMMENT ON COLUMN "organize-app-inbox".apps.technical_owner IS 'Technical owner of the application (renamed from owner)';
COMMENT ON COLUMN "organize-app-inbox".apps.billing_frequency IS 'Billing frequency/cycle (renamed from app_plan)';
