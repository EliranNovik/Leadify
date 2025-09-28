-- Fix foreign key relationships for proformainvoice table
-- This will allow Supabase to properly join the data for the invoiced dashboard

-- 1. Add foreign key constraint for lead_id -> leads_lead.id
-- First check if the constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_proformainvoice_lead_id' 
        AND table_name = 'proformainvoice'
    ) THEN
        ALTER TABLE public.proformainvoice 
        ADD CONSTRAINT fk_proformainvoice_lead_id 
        FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) 
        ON DELETE SET NULL;
        
        RAISE NOTICE 'Added foreign key constraint: fk_proformainvoice_lead_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_proformainvoice_lead_id already exists';
    END IF;
END $$;

-- 2. Add foreign key constraint for leads_lead.category_id -> misc_category.id
-- First check if the constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_category_id' 
        AND table_name = 'leads_lead'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD CONSTRAINT fk_leads_lead_category_id 
        FOREIGN KEY (category_id) REFERENCES public.misc_category(id) 
        ON DELETE SET NULL;
        
        RAISE NOTICE 'Added foreign key constraint: fk_leads_lead_category_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_leads_lead_category_id already exists';
    END IF;
END $$;

-- 3. Add foreign key constraint for misc_category.parent_id -> misc_maincategory.id
-- First check if the constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_misc_category_parent_id' 
        AND table_name = 'misc_category'
    ) THEN
        ALTER TABLE public.misc_category 
        ADD CONSTRAINT fk_misc_category_parent_id 
        FOREIGN KEY (parent_id) REFERENCES public.misc_maincategory(id) 
        ON DELETE SET NULL;
        
        RAISE NOTICE 'Added foreign key constraint: fk_misc_category_parent_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_misc_category_parent_id already exists';
    END IF;
END $$;

-- 4. Add foreign key constraint for misc_maincategory.department_id -> tenant_departement.id
-- First check if the constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_misc_maincategory_department_id' 
        AND table_name = 'misc_maincategory'
    ) THEN
        ALTER TABLE public.misc_maincategory 
        ADD CONSTRAINT fk_misc_maincategory_department_id 
        FOREIGN KEY (department_id) REFERENCES public.tenant_departement(id) 
        ON DELETE SET NULL;
        
        RAISE NOTICE 'Added foreign key constraint: fk_misc_maincategory_department_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_misc_maincategory_department_id already exists';
    END IF;
END $$;

-- 5. Refresh the Supabase schema cache to recognize the new foreign keys
NOTIFY pgrst, 'reload schema';

-- 6. Show the current foreign key constraints for verification
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
    AND tc.table_name IN ('proformainvoice', 'leads_lead', 'misc_category', 'misc_maincategory')
ORDER BY tc.table_name, tc.constraint_name;
