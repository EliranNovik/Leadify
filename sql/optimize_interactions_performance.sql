-- SQL Performance Optimizations for InteractionsTab
-- Run these queries to improve database performance for interactions loading

-- =====================================================
-- 1. CREATE INDEXES FOR FASTER QUERIES
-- =====================================================

-- Index for WhatsApp messages queries (most common)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id_sent_at 
ON whatsapp_messages (lead_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_id_sent_at 
ON whatsapp_messages (legacy_id, sent_at DESC);

-- Index for call logs queries with employee join
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id_cdate 
ON call_logs (lead_id, cdate DESC);

-- Note: client_id column may not exist in call_logs table
-- Only create this index if the column exists
-- CREATE INDEX IF NOT EXISTS idx_call_logs_client_id_cdate 
-- ON call_logs (client_id, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_employee_id 
ON call_logs (employee_id);

-- Index for emails queries
CREATE INDEX IF NOT EXISTS idx_emails_client_id_sent_at 
ON emails (client_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_legacy_id_sent_at 
ON emails (legacy_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_message_id 
ON emails (message_id);

-- Index for users table (for employee lookups)
CREATE INDEX IF NOT EXISTS idx_users_auth_id 
ON users (auth_id);

CREATE INDEX IF NOT EXISTS idx_users_employee_id 
ON users (employee_id);

-- Index for tenants_employee table
CREATE INDEX IF NOT EXISTS idx_tenants_employee_id 
ON tenants_employee (id);

-- =====================================================
-- 2. OPTIMIZE EXISTING FOREIGN KEY CONSTRAINTS
-- =====================================================

-- Ensure foreign key constraints are properly set for performance
-- (These should already exist from previous migrations, but let's verify)

-- Check if foreign keys exist
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee');

-- =====================================================
-- 3. CREATE MATERIALIZED VIEW FOR FREQUENT QUERIES
-- =====================================================

-- Create a materialized view for recent interactions (last 90 days)
-- This will significantly speed up queries for active clients
CREATE MATERIALIZED VIEW IF NOT EXISTS recent_interactions_summary AS
SELECT 
    'whatsapp' as interaction_type,
    id,
    COALESCE(lead_id::text, 'legacy_' || legacy_id::text) as client_id,
    sent_at as interaction_date,
    sender_name as employee_name,
    direction,
    whatsapp_status as status,
    message as content
FROM whatsapp_messages 
WHERE sent_at >= CURRENT_DATE - INTERVAL '90 days'

UNION ALL

SELECT 
    'call' as interaction_type,
    id::text as id,
    'legacy_' || lead_id::text as client_id,
    cdate as interaction_date,
    COALESCE(te.display_name, 'Unknown') as employee_name,
    CASE 
        WHEN direction ILIKE '%incoming%' THEN 'in'
        ELSE 'out'
    END as direction,
    status,
    CONCAT('From: ', COALESCE(source, ''), ', To: ', COALESCE(destination, '')) as content
FROM call_logs cl
LEFT JOIN tenants_employee te ON cl.employee_id = te.id
WHERE cdate >= CURRENT_DATE - INTERVAL '90 days'

UNION ALL

SELECT 
    'email' as interaction_type,
    message_id as id,
    COALESCE(client_id::text, 'legacy_' || legacy_id::text) as client_id,
    sent_at as interaction_date,
    sender_name as employee_name,
    CASE 
        WHEN direction = 'outgoing' THEN 'out'
        ELSE 'in'
    END as direction,
    status,
    COALESCE(subject, 'Email') as content
FROM emails 
WHERE sent_at >= CURRENT_DATE - INTERVAL '90 days';

-- Create index on the materialized view
CREATE INDEX IF NOT EXISTS idx_recent_interactions_client_date 
ON recent_interactions_summary (client_id, interaction_date DESC);

-- =====================================================
-- 4. CREATE FUNCTION TO REFRESH MATERIALIZED VIEW
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_recent_interactions()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY recent_interactions_summary;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. CREATE TRIGGER TO AUTO-REFRESH MATERIALIZED VIEW
-- =====================================================

-- Function to refresh materialized view when data changes
CREATE OR REPLACE FUNCTION trigger_refresh_recent_interactions()
RETURNS trigger AS $$
BEGIN
    -- Use a background job or simple refresh
    -- For now, we'll refresh immediately (could be optimized with pg_cron)
    PERFORM refresh_recent_interactions();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for each table
DROP TRIGGER IF EXISTS trigger_whatsapp_refresh ON whatsapp_messages;
CREATE TRIGGER trigger_whatsapp_refresh
    AFTER INSERT OR UPDATE OR DELETE ON whatsapp_messages
    FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_recent_interactions();

DROP TRIGGER IF EXISTS trigger_call_logs_refresh ON call_logs;
CREATE TRIGGER trigger_call_logs_refresh
    AFTER INSERT OR UPDATE OR DELETE ON call_logs
    FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_recent_interactions();

DROP TRIGGER IF EXISTS trigger_emails_refresh ON emails;
CREATE TRIGGER trigger_emails_refresh
    AFTER INSERT OR UPDATE OR DELETE ON emails
    FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_recent_interactions();

-- =====================================================
-- 6. INITIAL REFRESH OF MATERIALIZED VIEW
-- =====================================================

-- Refresh the materialized view for the first time
REFRESH MATERIALIZED VIEW recent_interactions_summary;

-- =====================================================
-- 7. CREATE OPTIMIZED QUERY FUNCTIONS
-- =====================================================

-- Function to get recent interactions for a client (optimized)
CREATE OR REPLACE FUNCTION get_client_interactions(
    p_client_id TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    id TEXT,
    interaction_type TEXT,
    interaction_date TIMESTAMP WITH TIME ZONE,
    employee_name TEXT,
    direction TEXT,
    status TEXT,
    content TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ris.id,
        ris.interaction_type,
        ris.interaction_date,
        ris.employee_name,
        ris.direction,
        ris.status,
        ris.content
    FROM recent_interactions_summary ris
    WHERE ris.client_id = p_client_id
    ORDER BY ris.interaction_date DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get employee display name (cached)
CREATE OR REPLACE FUNCTION get_employee_display_name(p_employee_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    display_name TEXT;
BEGIN
    SELECT te.display_name INTO display_name
    FROM tenants_employee te
    WHERE te.id = p_employee_id;
    
    RETURN COALESCE(display_name, 'Unknown Employee');
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. PERFORMANCE MONITORING QUERIES
-- =====================================================

-- Query to check index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY idx_tup_read DESC;

-- Query to check table sizes
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size
FROM pg_tables 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY pg_total_relation_size(tablename::regclass) DESC;

-- Query to check slow queries (if pg_stat_statements is enabled)
-- SELECT 
--     query,
--     calls,
--     total_time,
--     mean_time,
--     rows
-- FROM pg_stat_statements 
-- WHERE query ILIKE '%whatsapp_messages%' OR query ILIKE '%call_logs%' OR query ILIKE '%emails%'
-- ORDER BY mean_time DESC
-- LIMIT 10;

-- =====================================================
-- 9. CLEANUP AND MAINTENANCE
-- =====================================================

-- Update table statistics for better query planning
ANALYZE whatsapp_messages;
ANALYZE call_logs;
ANALYZE emails;
ANALYZE users;
ANALYZE tenants_employee;

-- =====================================================
-- 10. USAGE EXAMPLES
-- =====================================================

-- Example 1: Get recent interactions for a client
-- SELECT * FROM get_client_interactions('legacy_12345', 30);

-- Example 2: Get employee display name
-- SELECT get_employee_display_name(123);

-- Example 3: Query materialized view directly
-- SELECT * FROM recent_interactions_summary 
-- WHERE client_id = 'legacy_12345' 
-- ORDER BY interaction_date DESC 
-- LIMIT 20;

-- =====================================================
-- NOTES:
-- =====================================================
-- 1. Run this script in your Supabase SQL editor
-- 2. The materialized view will auto-refresh when data changes
-- 3. Consider setting up pg_cron for periodic maintenance
-- 4. Monitor query performance with the provided monitoring queries
-- 5. Adjust the 90-day window in the materialized view based on your needs
-- 6. The indexes will significantly speed up common queries
-- 7. The materialized view provides a single source for recent interactions
