-- Step 1: Check what country IDs exist in both tables
-- This will help us understand the data mismatch

-- Check existing country IDs in leads_contact
SELECT 
    'leads_contact' as table_name,
    country_id,
    COUNT(*) as count
FROM leads_contact 
WHERE country_id IS NOT NULL
GROUP BY country_id
ORDER BY country_id;

-- Check existing country IDs in misc_country
SELECT 
    'misc_country' as table_name,
    id,
    name,
    iso_code
FROM misc_country 
ORDER BY id;

-- Find orphaned country_id values in leads_contact
SELECT DISTINCT 
    lc.country_id,
    COUNT(*) as record_count
FROM leads_contact lc
LEFT JOIN misc_country mc ON lc.country_id = mc.id
WHERE lc.country_id IS NOT NULL 
    AND mc.id IS NULL
GROUP BY lc.country_id
ORDER BY lc.country_id;

-- Step 2: Fix the data by setting orphaned country_id values to NULL
-- This will allow us to add the foreign key constraint

UPDATE leads_contact 
SET country_id = NULL 
WHERE country_id IS NOT NULL 
    AND country_id NOT IN (SELECT id FROM misc_country);

-- Step 3: Add the foreign key constraint
-- First, check if the foreign key already exists
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

-- Step 4: Create index on country_id for better performance
CREATE INDEX IF NOT EXISTS idx_leads_contact_country_id 
ON public.leads_contact (country_id) 
WHERE country_id IS NOT NULL;

-- Step 5: Verify the constraint was created
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

-- Step 6: Final verification - check that all country_id values now have valid references
SELECT 
    'Verification' as check_type,
    COUNT(*) as total_records,
    COUNT(country_id) as records_with_country,
    COUNT(CASE WHEN country_id IS NOT NULL THEN 1 END) as valid_country_refs
FROM leads_contact lc
LEFT JOIN misc_country mc ON lc.country_id = mc.id
WHERE lc.country_id IS NULL OR mc.id IS NOT NULL;
