-- SQL script to ensure foreign key constraints exist for currency_id joins
-- This enables the Supabase joins: accounting_currencies!leads_currency_id_fkey and accounting_currencies!leads_lead_currency_id_fkey

-- Check if foreign key constraint exists for leads table, create if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'leads_currency_id_fkey'
    ) THEN
        ALTER TABLE public.leads
        ADD CONSTRAINT leads_currency_id_fkey 
        FOREIGN KEY (currency_id) 
        REFERENCES public.accounting_currencies(id);
        
        RAISE NOTICE 'Created foreign key constraint: leads_currency_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint leads_currency_id_fkey already exists';
    END IF;
END $$;

-- Check if foreign key constraint exists for leads_lead table, create if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'leads_lead_currency_id_fkey'
    ) THEN
        ALTER TABLE public.leads_lead
        ADD CONSTRAINT leads_lead_currency_id_fkey 
        FOREIGN KEY (currency_id) 
        REFERENCES public.accounting_currencies(id);
        
        RAISE NOTICE 'Created foreign key constraint: leads_lead_currency_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint leads_lead_currency_id_fkey already exists';
    END IF;
END $$;

-- Create index on currency_id in leads table if it doesn't exist (for better join performance)
CREATE INDEX IF NOT EXISTS idx_leads_currency_id 
ON public.leads(currency_id) 
WHERE currency_id IS NOT NULL;

-- Create index on currency_id in leads_lead table if it doesn't exist (for better join performance)
CREATE INDEX IF NOT EXISTS idx_leads_lead_currency_id 
ON public.leads_lead(currency_id) 
WHERE currency_id IS NOT NULL;

-- Verify the constraints exist
SELECT 
    tc.table_name, 
    tc.constraint_name, 
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
    AND tc.table_schema = 'public'
    AND (tc.table_name = 'leads' OR tc.table_name = 'leads_lead')
    AND kcu.column_name = 'currency_id'
ORDER BY tc.table_name, tc.constraint_name;
