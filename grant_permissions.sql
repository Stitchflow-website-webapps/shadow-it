-- Grant permissions for service role to access AI-database-shadow-it schema
-- Run these commands in your Supabase SQL editor

-- 1. Grant usage on the schema
GRANT USAGE ON SCHEMA "AI-database-shadow-it" TO service_role;

-- 2. Grant SELECT permissions on ai_risk_scores table (for reading tool names and app_ids)
GRANT SELECT ON "AI-database-shadow-it".ai_risk_scores TO service_role;

-- 3. Grant full permissions on org_apps table (for inserting/updating organization apps)
GRANT SELECT, INSERT, UPDATE, DELETE ON "AI-database-shadow-it".org_apps TO service_role;

-- 4. Grant usage on the sequence for org_apps id column (needed for INSERT operations)
GRANT USAGE, SELECT ON SEQUENCE "AI-database-shadow-it".org_apps_id_seq TO service_role;

-- 5. Grant permissions on any functions (if you have triggers or stored procedures)
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO service_role;

-- Optional: If you want to grant permissions on all future tables in this schema
ALTER DEFAULT PRIVILEGES IN SCHEMA "AI-database-shadow-it" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "AI-database-shadow-it" GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- Verify permissions (optional - for checking what was granted)
-- SELECT 
--   schemaname, 
--   tablename, 
--   grantor, 
--   grantee, 
--   privilege_type 
-- FROM information_schema.table_privileges 
-- WHERE grantee = 'service_role' 
--   AND schemaname = 'AI-database-shadow-it'; 