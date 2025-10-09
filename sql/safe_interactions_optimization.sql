-- Safe Performance Optimization for InteractionsTab
-- This version checks for column existence before creating indexes

-- =====================================================
-- 1. CHECK TABLE SCHEMAS FIRST
-- =====================================================

-- Check what columns exist in each table
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY table_name, ordinal_position;

-- =====================================================
-- 2. CREATE INDEXES ONLY FOR EXISTING COLUMNS
-- =====================================================

-- WhatsApp messages indexes (these should exist)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id_sent_at 
ON whatsapp_messages (lead_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_id_sent_at 
ON whatsapp_messages (legacy_id, sent_at DESC);

-- Call logs indexes (only for columns that exist)
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id_cdate 
ON call_logs (lead_id, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_employee_id 
ON call_logs (employee_id);

-- Emails indexes (only for columns that exist)
CREATE INDEX IF NOT EXISTS idx_emails_client_id_sent_at 
ON emails (client_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_legacy_id_sent_at 
ON emails (legacy_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_message_id 
ON emails (message_id);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_auth_id 
ON users (auth_id);

CREATE INDEX IF NOT EXISTS idx_users_employee_id 
ON users (employee_id);

-- Tenants_employee indexes
CREATE INDEX IF NOT EXISTS idx_tenants_employee_id 
ON tenants_employee (id);

-- =====================================================
-- 3. CONDITIONAL INDEX CREATION FOR POTENTIAL COLUMNS
-- =====================================================

-- Only create client_id index for call_logs if the column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'call_logs' AND column_name = 'client_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_call_logs_client_id_cdate 
        ON call_logs (client_id, cdate DESC);
        RAISE NOTICE 'Created index for call_logs.client_id';
    ELSE
        RAISE NOTICE 'call_logs.client_id column does not exist, skipping index creation';
    END IF;
END $$;

-- =====================================================
-- 4. UPDATE TABLE STATISTICS
-- =====================================================

ANALYZE whatsapp_messages;
ANALYZE call_logs;
ANALYZE emails;
ANALYZE users;
ANALYZE tenants_employee;

-- =====================================================
-- 5. VERIFY INDEXES WERE CREATED
-- =====================================================

SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY tablename, indexname;

-- =====================================================
-- 6. CHECK TABLE SIZES
-- =====================================================

SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size,
    pg_total_relation_size(tablename::regclass) as size_bytes
FROM pg_tables 
WHERE tablename IN ('whatsapp_messages', 'call_logs', 'emails', 'users', 'tenants_employee')
ORDER BY pg_total_relation_size(tablename::regclass) DESC;
