-- Performance Indexes for shadow_it schema
-- These indexes will dramatically improve query performance for large organizations

-- =====================================================
-- APPLICATIONS TABLE INDEXES
-- =====================================================

-- Primary query filter - most important index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_id 
ON shadow_it.applications (organization_id);

-- For deduplication queries (grouping by name within org)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_name 
ON shadow_it.applications (organization_id, name);

-- For sorting and filtering by creation date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_created 
ON shadow_it.applications (organization_id, created_at DESC);

-- For risk level filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_risk 
ON shadow_it.applications (organization_id, risk_level);

-- For management status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_status 
ON shadow_it.applications (organization_id, management_status);

-- Composite index for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_name_created 
ON shadow_it.applications (organization_id, name, created_at DESC);

-- =====================================================
-- USER_APPLICATIONS TABLE INDEXES
-- =====================================================

-- Primary foreign key - critical for JOINs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_applications_app_id 
ON shadow_it.user_applications (application_id);

-- For user-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_applications_user_id 
ON shadow_it.user_applications (user_id);

-- Composite index for the main JOIN pattern used in the API
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_applications_app_user 
ON shadow_it.user_applications (application_id, user_id);

-- For deduplication queries (finding duplicate user-app combinations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_applications_user_app_created 
ON shadow_it.user_applications (user_id, application_id, created_at);

-- For scope-based queries (if needed for risk calculations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_applications_app_scopes 
ON shadow_it.user_applications (application_id) 
WHERE scopes IS NOT NULL AND array_length(scopes, 1) > 0;

-- =====================================================
-- USERS TABLE INDEXES (for the JOINs)
-- =====================================================

-- Primary org filter for users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_id 
ON shadow_it.users (organization_id);

-- For email-based lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_email 
ON shadow_it.users (organization_id, email);

-- For name-based searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_name 
ON shadow_it.users (organization_id, name);

-- =====================================================
-- ADDITIONAL PERFORMANCE INDEXES
-- =====================================================

-- For Microsoft app filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_microsoft_app 
ON shadow_it.applications (organization_id, microsoft_app_id) 
WHERE microsoft_app_id IS NOT NULL;

-- For Google app filtering  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_google_app 
ON shadow_it.applications (organization_id, google_app_id) 
WHERE google_app_id IS NOT NULL;

-- For category filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_org_category 
ON shadow_it.applications (organization_id, category);

-- Partial index for active applications (non-null management status)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_active 
ON shadow_it.applications (organization_id, management_status, created_at DESC) 
WHERE management_status IS NOT NULL;

-- =====================================================
-- QUERY PERFORMANCE ANALYSIS
-- =====================================================

-- After creating indexes, run these queries to verify performance:

-- Check index usage:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch 
-- FROM pg_stat_user_indexes 
-- WHERE schemaname = 'shadow_it' 
-- ORDER BY idx_scan DESC;

-- Check table sizes:
-- SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
-- FROM pg_tables 
-- WHERE schemaname = 'shadow_it' 
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Test query performance (replace 'your-org-id' with actual org ID):
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT * FROM shadow_it.applications 
-- WHERE organization_id = 'your-org-id' 
-- LIMIT 100; 