-- Fix proformainvoice table to match the original accdocs_proformainvoice structure
-- This will ensure proper foreign key relationships and data types

-- 1. First, let's check the current structure of proformainvoice
SELECT 
    'Current proformainvoice structure:' as info,
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'proformainvoice'
ORDER BY ordinal_position;

-- 2. Check if the original accdocs_proformainvoice table exists
SELECT 
    'Checking for original table:' as info,
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_name IN ('accdocs_proformainvoice', 'proformainvoice')
ORDER BY table_name;

-- 3. Fix the lead_id column type from numeric to integer (to match original)
ALTER TABLE public.proformainvoice 
ALTER COLUMN lead_id TYPE integer USING lead_id::integer;

-- 4. Make lead_id NOT NULL (to match original structure)
ALTER TABLE public.proformainvoice 
ALTER COLUMN lead_id SET NOT NULL;

-- 5. Add the foreign key constraint (matching the original)
ALTER TABLE public.proformainvoice 
ADD CONSTRAINT fk_proformainvoice_lead_id 
FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- 6. Add index for lead_id (matching the original)
CREATE INDEX IF NOT EXISTS idx_proformainvoice_lead_id 
ON public.proformainvoice USING btree (lead_id);

-- 7. Refresh the Supabase schema cache
NOTIFY pgrst, 'reload schema';

-- 8. Verify the changes
SELECT 
    'Updated proformainvoice structure:' as info,
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'proformainvoice'
    AND column_name = 'lead_id';

-- 9. Verify the foreign key constraint
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
    AND tc.table_name = 'proformainvoice';

-- 10. Check if we should consider using the original table instead
SELECT 
    'Data comparison:' as info,
    'proformainvoice' as table_name,
    COUNT(*) as record_count
FROM public.proformainvoice
UNION ALL
SELECT 
    'Data comparison:' as info,
    'accdocs_proformainvoice' as table_name,
    COUNT(*) as record_count
FROM public.accdocs_proformainvoice;
