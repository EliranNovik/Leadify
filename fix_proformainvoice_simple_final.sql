-- Fix the current proformainvoice table to have proper foreign key relationships
-- Since accdocs_proformainvoice doesn't exist, we'll fix the current table

-- 1. Check current structure of proformainvoice
SELECT 
    'Current proformainvoice structure:' as info,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'proformainvoice'
    AND column_name IN ('id', 'lead_id', 'sub_total', 'cdate')
ORDER BY ordinal_position;

-- 2. Check current data in lead_id column
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

-- 4. Convert lead_id from numeric to bigint (to match leads_lead.id)
ALTER TABLE public.proformainvoice 
ALTER COLUMN lead_id TYPE bigint USING lead_id::bigint;

-- 5. Add the foreign key constraint
ALTER TABLE public.proformainvoice 
ADD CONSTRAINT fk_proformainvoice_lead_id 
FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
ON DELETE SET NULL;

-- 6. Add index for lead_id for better performance
CREATE INDEX IF NOT EXISTS idx_proformainvoice_lead_id 
ON public.proformainvoice USING btree (lead_id);

-- 7. Refresh the Supabase schema cache
NOTIFY pgrst, 'reload schema';

-- 8. Verify the changes
SELECT 
    'Updated proformainvoice structure:' as info,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'proformainvoice'
    AND column_name = 'lead_id';

-- 9. Verify the foreign key constraint was added
SELECT 
    'Foreign key constraints:' as info,
    tc.table_name, 
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
    AND tc.table_name = 'proformaininvoice';

-- 10. Test the relationship by checking if joins work
SELECT 
    'Test join:' as info,
    COUNT(*) as joined_records
FROM public.proformainvoice p
JOIN public.leads_lead l ON p.lead_id = l.id;
