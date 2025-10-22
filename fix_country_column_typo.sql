-- Fix the typo in the country column and foreign key constraint
-- The issue is that the column name and constraint name have typos

-- First, let's check what the current column name is
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name LIKE '%countr%';

-- Check existing constraints
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
    AND tc.table_name = 'leads'
    AND kcu.column_name LIKE '%countr%';

-- If the column is named 'counrty_id' (with typo), we need to rename it
-- Step 1: Drop the existing foreign key constraint
DO $$
BEGIN
    -- Drop the constraint if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_counrty_id_fkey' 
        AND table_name = 'leads'
    ) THEN
        ALTER TABLE public.leads DROP CONSTRAINT leads_counrty_id_fkey;
        RAISE NOTICE 'Dropped constraint leads_counrty_id_fkey';
    END IF;
END $$;

-- Step 2: Rename the column from 'counrty_id' to 'country_id'
DO $$
BEGIN
    -- Check if column exists with typo and rename it
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'leads' 
        AND column_name = 'counrty_id'
    ) THEN
        ALTER TABLE public.leads RENAME COLUMN counrty_id TO country_id;
        RAISE NOTICE 'Renamed column counrty_id to country_id';
    END IF;
END $$;

-- Step 3: Add the correct foreign key constraint
DO $$
BEGIN
    -- Add the correct foreign key constraint
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_country_id_fkey' 
        AND table_name = 'leads'
    ) THEN
        ALTER TABLE public.leads 
        ADD CONSTRAINT leads_country_id_fkey 
        FOREIGN KEY (country_id) 
        REFERENCES public.misc_country(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE;
        
        RAISE NOTICE 'Added constraint leads_country_id_fkey';
    ELSE
        RAISE NOTICE 'Constraint leads_country_id_fkey already exists';
    END IF;
END $$;

-- Step 4: Create index for performance
CREATE INDEX IF NOT EXISTS idx_leads_country_id 
ON public.leads (country_id) 
WHERE country_id IS NOT NULL;

-- Step 5: Verify the fix
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
    AND tc.table_name = 'leads'
    AND kcu.column_name = 'country_id';

-- Final verification - check the column exists with correct name
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name = 'country_id';
