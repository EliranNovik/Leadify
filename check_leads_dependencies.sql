-- Script to check how many dependent records exist before deletion
-- Run this FIRST to understand the impact

-- Check leads count
SELECT 'Total leads to delete' as description, COUNT(*) as count FROM leads;

-- Check leads_leadstage references
SELECT 'leads_leadstage records' as description, COUNT(*) as count 
FROM leads_leadstage 
WHERE newlead_id IS NOT NULL;

-- Check follow_ups references
SELECT 'follow_ups records' as description, COUNT(*) as count 
FROM follow_ups 
WHERE new_lead_id IS NOT NULL;

-- Check meetings references
SELECT 'meetings records' as description, COUNT(*) as count 
FROM meetings 
WHERE client_id IS NOT NULL;

-- Check emails references
SELECT 'emails records' as description, COUNT(*) as count 
FROM emails 
WHERE lead_id IS NOT NULL;

-- Check whatsapp_messages references
SELECT 'whatsapp_messages records' as description, COUNT(*) as count 
FROM whatsapp_messages 
WHERE lead_id IS NOT NULL;

-- Check contacts references
SELECT 'contacts records' as description, COUNT(*) as count 
FROM contacts 
WHERE lead_id IS NOT NULL;

-- Check user_highlights references
SELECT 'user_highlights records' as description, COUNT(*) as count 
FROM user_highlights 
WHERE lead_id IS NOT NULL;

-- Check lead_changes references
SELECT 'lead_changes records' as description, COUNT(*) as count 
FROM lead_changes 
WHERE lead_id IS NOT NULL;

-- Show sample of foreign key constraints
SELECT
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
  AND ccu.table_name = 'leads';

