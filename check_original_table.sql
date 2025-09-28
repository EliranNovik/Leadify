-- Check if we should use the original accdocs_proformainvoice table instead
-- This will help determine the best approach

-- 1. Check if both tables exist and their record counts
SELECT 
    'Table existence and record counts:' as info,
    table_name,
    CASE 
        WHEN table_name = 'proformainvoice' THEN (SELECT COUNT(*) FROM public.proformainvoice)
        WHEN table_name = 'accdocs_proformainvoice' THEN (SELECT COUNT(*) FROM public.accdocs_proformainvoice)
    END as record_count
FROM information_schema.tables 
WHERE table_name IN ('accdocs_proformainvoice', 'proformainvoice')
ORDER BY table_name;

-- 2. Compare the structure of both tables
SELECT 
    'proformainvoice columns:' as info,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'proformainvoice'
ORDER BY ordinal_position;

SELECT 
    'accdocs_proformainvoice columns:' as info,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'accdocs_proformainvoice'
ORDER BY ordinal_position;

-- 3. Check foreign key constraints on both tables
SELECT 
    'proformainvoice foreign keys:' as info,
    tc.constraint_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'proformainvoice';

SELECT 
    'accdocs_proformainvoice foreign keys:' as info,
    tc.constraint_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'accdocs_proformainvoice';

-- 4. Sample data from both tables to compare
SELECT 
    'Sample from proformainvoice:' as info,
    id, lead_id, sub_total, cdate
FROM public.proformainvoice 
LIMIT 3;

SELECT 
    'Sample from accdocs_proformaininvoice:' as info,
    id, lead_id, sub_total, cdate
FROM public.accdocs_proformainvoice 
LIMIT 3;
