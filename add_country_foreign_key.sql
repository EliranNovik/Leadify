-- Add foreign key constraint between leads_contact.country_id and misc_country.id
-- This connects the country_id column in leads_contact to the misc_country table

-- First, let's check if the foreign key already exists
DO $$
BEGIN
    -- Check if the foreign key constraint already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_contact_country_id' 
        AND table_name = 'leads_contact'
    ) THEN
        -- Add the foreign key constraint
        ALTER TABLE public.leads_contact 
        ADD CONSTRAINT fk_leads_contact_country_id 
        FOREIGN KEY (country_id) 
        REFERENCES public.misc_country(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE;
        
        RAISE NOTICE 'Foreign key constraint fk_leads_contact_country_id added successfully';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_leads_contact_country_id already exists';
    END IF;
END $$;

-- Create index on country_id for better performance
CREATE INDEX IF NOT EXISTS idx_leads_contact_country_id 
ON public.leads_contact (country_id) 
WHERE country_id IS NOT NULL;

-- Verify the constraint was created
SELECT 
    tc.constraint_name,
    tc.table_name,
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
    AND tc.table_name = 'leads_contact'
    AND kcu.column_name = 'country_id';
