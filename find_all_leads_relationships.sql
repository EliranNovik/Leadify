-- Script to find ALL tables connected to the leads table
-- This shows you the complete relationship map

-- ============================================
-- TABLES THAT REFERENCE LEADS (Foreign Keys)
-- ============================================
SELECT 
    'REFERENCES leads' AS relationship_type,
    tc.table_name AS related_table,
    kcu.column_name AS column_name,
    rc.delete_rule AS current_delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ Will auto-delete'
        WHEN rc.delete_rule = 'SET NULL' THEN '⚠ Will set to NULL'
        WHEN rc.delete_rule = 'RESTRICT' THEN '✗ Will block deletion'
        WHEN rc.delete_rule = 'NO ACTION' THEN '✗ Will block deletion'
        ELSE rc.delete_rule
    END as deletion_behavior
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY' 
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- ============================================
-- COUNT OF RECORDS IN EACH RELATED TABLE
-- ============================================

-- This section will show you how many records exist in each related table
-- You'll need to run the queries for tables that actually exist

-- Example queries (uncomment and run for tables that exist):

-- SELECT 'leads_leadstage' as table_name, COUNT(*) FROM leads_leadstage WHERE newlead_id IS NOT NULL;
-- SELECT 'follow_ups' as table_name, COUNT(*) FROM follow_ups WHERE new_lead_id IS NOT NULL;
-- SELECT 'meetings' as table_name, COUNT(*) FROM meetings WHERE client_id IS NOT NULL;
-- SELECT 'emails' as table_name, COUNT(*) FROM emails WHERE lead_id IS NOT NULL;
-- SELECT 'contacts' as table_name, COUNT(*) FROM contacts WHERE lead_id IS NOT NULL;
-- SELECT 'user_highlights' as table_name, COUNT(*) FROM user_highlights WHERE lead_id IS NOT NULL;
-- SELECT 'lead_changes' as table_name, COUNT(*) FROM lead_changes WHERE lead_id IS NOT NULL;

-- ============================================
-- AFTER CASCADE IS ENABLED: Simple deletion
-- ============================================

-- Once you've run add_cascade_to_leads.sql, you can simply run:
-- DELETE FROM leads;
-- And all related records will be automatically deleted!

-- To delete all leads:
-- DELETE FROM leads;

-- To delete specific leads:
-- DELETE FROM leads WHERE created_at < '2024-01-01';  -- Example: delete old leads
-- DELETE FROM leads WHERE stage = 'some_stage';       -- Example: delete by stage

