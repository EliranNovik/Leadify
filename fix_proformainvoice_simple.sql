-- Simple fix for proformainvoice foreign key relationships
-- This adds the essential foreign key constraint for lead_id

-- Add foreign key constraint for lead_id -> leads_lead.id
ALTER TABLE public.proformainvoice 
ADD CONSTRAINT fk_proformainvoice_lead_id 
FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
ON DELETE SET NULL;

-- Refresh the Supabase schema cache
NOTIFY pgrst, 'reload schema';

-- Verify the constraint was added
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
