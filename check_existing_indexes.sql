-- Check existing indexes in shadow_it schema with full definitions
-- Run these queries in your Supabase SQL editor

-- =====================================================
-- 1. LIST ALL INDEXES IN SHADOW_IT SCHEMA
-- =====================================================

SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'shadow_it'
ORDER BY tablename, indexname;

-- =====================================================
-- 2. DETAILED INDEX INFORMATION WITH COLUMNS
-- =====================================================

SELECT 
    t.relname AS table_name,
    i.relname AS index_name,
    ix.indisunique AS is_unique,
    ix.indisprimary AS is_primary,
    ix.indisclustered AS is_clustered,
    am.amname AS index_type,
    array_to_string(
        array_agg(
            a.attname 
            ORDER BY array_position(ix.indkey, a.attnum)
        ), 
        ', '
    ) AS columns,
    pg_get_indexdef(ix.indexrelid) AS index_definition
FROM 
    pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_am am ON am.oid = i.relam
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE 
    n.nspname = 'shadow_it'
GROUP BY 
    t.relname, i.relname, ix.indisunique, ix.indisprimary, 
    ix.indisclustered, am.amname, ix.indexrelid
ORDER BY 
    t.relname, i.relname;

-- =====================================================
-- 3. CHECK SPECIFIC TABLES (applications, user_applications, users)
-- =====================================================

-- Applications table indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'shadow_it' 
  AND tablename = 'applications'
ORDER BY indexname;

-- User Applications table indexes  
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'shadow_it' 
  AND tablename = 'user_applications'
ORDER BY indexname;

-- Users table indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'shadow_it' 
  AND tablename = 'users'
ORDER BY indexname;

-- =====================================================
-- 4. CHECK INDEX USAGE STATISTICS
-- =====================================================

SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
WHERE schemaname = 'shadow_it'
ORDER BY idx_scan DESC;

-- =====================================================
-- 5. CHECK IF SPECIFIC PERFORMANCE INDEXES EXIST
-- =====================================================

-- Check for the key indexes we need for performance
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'shadow_it' 
              AND tablename = 'applications' 
              AND indexname = 'idx_applications_org_id'
        ) THEN '✅ EXISTS' 
        ELSE '❌ MISSING' 
    END AS idx_applications_org_id,
    
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'shadow_it' 
              AND tablename = 'applications' 
              AND indexname = 'idx_applications_org_name'
        ) THEN '✅ EXISTS' 
        ELSE '❌ MISSING' 
    END AS idx_applications_org_name,
    
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'shadow_it' 
              AND tablename = 'user_applications' 
              AND indexname = 'idx_user_applications_app_id'
        ) THEN '✅ EXISTS' 
        ELSE '❌ MISSING' 
    END AS idx_user_applications_app_id,
    
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'shadow_it' 
              AND tablename = 'users' 
              AND indexname = 'idx_users_org_id'
        ) THEN '✅ EXISTS' 
        ELSE '❌ MISSING' 
    END AS idx_users_org_id;

-- =====================================================
-- 6. TABLE SIZES AND ROW COUNTS
-- =====================================================

SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    (SELECT count(*) FROM shadow_it.applications WHERE tablename = 'applications') as row_count_estimate
FROM pg_tables 
WHERE schemaname = 'shadow_it'
  AND tablename IN ('applications', 'user_applications', 'users')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- =====================================================
-- 7. ANALYZE QUERY PERFORMANCE (TEST WITH YOUR ORG ID)
-- =====================================================

-- Replace 'your-org-id-here' with your actual large organization ID
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT count(*) 
-- FROM shadow_it.applications 
-- WHERE organization_id = 'your-org-id-here';

-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT a.id, a.name, count(ua.id) as user_count
-- FROM shadow_it.applications a
-- LEFT JOIN shadow_it.user_applications ua ON a.id = ua.application_id
-- WHERE a.organization_id = 'your-org-id-here'
-- GROUP BY a.id, a.name
-- LIMIT 10; 