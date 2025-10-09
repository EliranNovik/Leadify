-- Quick Performance Optimization for InteractionsTab
-- Run these essential queries first for immediate performance improvement

-- =====================================================
-- 1. ESSENTIAL INDEXES (Run these first)
-- =====================================================

-- WhatsApp messages indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id_sent_at 
ON whatsapp_messages (lead_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_id_sent_at 
ON whatsapp_messages (legacy_id, sent_at DESC);

-- Call logs indexes
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id_cdate 
ON call_logs (lead_id, cdate DESC);

-- Note: client_id column may not exist in call_logs table
-- Only create this index if the column exists
-- CREATE INDEX IF NOT EXISTS idx_call_logs_client_id_cdate 
-- ON call_logs (client_id, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_employee_id 
ON call_logs (employee_id);

-- Emails indexes
CREATE INDEX IF NOT EXISTS idx_emails_client_id_sent_at 
ON emails (client_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_legacy_id_sent_at 
ON emails (legacy_id, sent_at DESC);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_auth_id 
ON users (auth_id);

CREATE INDEX IF NOT EXISTS idx_users_employee_id 
ON users (employee_id);

-- =====================================================
-- 2. UPDATE TABLE STATISTICS
-- =====================================================

ANALYZE whatsapp_messages;
ANALYZE call_logs;
ANALYZE emails;
ANALYZE users;
ANALYZE tenants_employee;

-- =====================================================
-- 3. VERIFY INDEXES WERE CREATED
-- =====================================================

SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users')
ORDER BY tablename, indexname;

-- =====================================================
-- 4. CHECK TABLE SIZES
-- =====================================================

SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size,
    pg_total_relation_size(tablename::regclass) as size_bytes
FROM pg_tables 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY pg_total_relation_size(tablename::regclass) DESC;
