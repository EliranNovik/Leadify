-- Fix data type mismatch for proformainvoice foreign key relationships
-- The lead_id column needs to be converted from numeric to bigint to match leads_lead.id

-- 1. First, let's check the current data types
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('proformainvoice', 'leads_lead') 
    AND column_name IN ('id', 'lead_id')
ORDER BY table_name, column_name;

-- 2. Convert lead_id from numeric to bigint in proformainvoice table
-- This will preserve the data while changing the type
ALTER TABLE public.proformainvoice 
ALTER COLUMN lead_id TYPE bigint USING lead_id::bigint;

-- 3. Now add the foreign key constraint
ALTER TABLE public.proformainvoice 
ADD CONSTRAINT fk_proformainvoice_lead_id 
FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
ON DELETE SET NULL;

-- 4. Refresh the Supabase schema cache
NOTIFY pgrst, 'reload schema';

-- 5. Verify the constraint was added and data types are correct
SELECT 
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

-- 6. Show the updated data types
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('proformainvoice', 'leads_lead') 
    AND column_name IN ('id', 'lead_id')
ORDER BY table_name, column_name;
