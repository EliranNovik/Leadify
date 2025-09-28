-- Safe fix for proformainvoice data type and foreign key issues
-- This version includes data validation before making changes

-- 1. Check current data types
SELECT 
    'Current data types:' as info,
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('proformainvoice', 'leads_lead') 
    AND column_name IN ('id', 'lead_id')
ORDER BY table_name, column_name;

-- 2. Check for potential data issues in lead_id column
SELECT 
    'Data validation:' as info,
    COUNT(*) as total_records,
    COUNT(lead_id) as non_null_lead_ids,
    COUNT(*) - COUNT(lead_id) as null_lead_ids,
    MIN(lead_id) as min_lead_id,
    MAX(lead_id) as max_lead_id
FROM public.proformainvoice;

-- 3. Check if there are any lead_id values that don't exist in leads_lead table
SELECT 
    'Orphaned lead_ids:' as info,
    COUNT(*) as orphaned_count
FROM public.proformainvoice p
LEFT JOIN public.leads_lead l ON p.lead_id::bigint = l.id
WHERE p.lead_id IS NOT NULL AND l.id IS NULL;

-- 4. If there are orphaned records, show some examples
SELECT 
    'Sample orphaned records:' as info,
    p.id as proforma_id,
    p.lead_id,
    p.cdate
FROM public.proformainvoice p
LEFT JOIN public.leads_lead l ON p.lead_id::bigint = l.id
WHERE p.lead_id IS NOT NULL AND l.id IS NULL
LIMIT 5;

-- 5. Convert lead_id from numeric to bigint (only if no orphaned records)
-- Uncomment the following lines if the data validation looks good:

-- ALTER TABLE public.proformainvoice 
-- ALTER COLUMN lead_id TYPE bigint USING lead_id::bigint;

-- 6. Add the foreign key constraint (only if conversion was successful)
-- Uncomment the following lines if the data type conversion was successful:

-- ALTER TABLE public.proformainvoice 
-- ADD CONSTRAINT fk_proformainvoice_lead_id 
-- FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
-- ON DELETE SET NULL;

-- 7. Refresh the Supabase schema cache (only if foreign key was added)
-- Uncomment the following line if the foreign key was added:

-- NOTIFY pgrst, 'reload schema';
