-- Quick patch to test if foreign key relationships exist
-- Run this first to check the current state

-- Check if foreign key constraints exist
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name IN ('leads_leadstage', 'proformas')
    AND kcu.column_name = 'lead_id';

-- Check table structures
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('leads_leadstage', 'leads_lead', 'proformas')
    AND column_name IN ('id', 'lead_id')
ORDER BY table_name, column_name;

-- Test basic JOIN queries
SELECT COUNT(*) as leads_leadstage_count FROM leads_leadstage;
SELECT COUNT(*) as leads_lead_count FROM leads_lead;
SELECT COUNT(*) as proformas_count FROM proformas;

-- Test if JOINs work
SELECT COUNT(*) as join_test_count
FROM leads_leadstage ll
JOIN leads_lead l ON ll.lead_id = l.id
LIMIT 1;
