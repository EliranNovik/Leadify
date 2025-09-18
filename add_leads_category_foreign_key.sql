-- Add foreign key constraint between leads.category_id and misc_category.id
-- This will enable proper JOINs in Supabase queries

-- First, let's check if the category_id column exists in the leads table
-- If it doesn't exist, we'll add it first
DO $$
BEGIN
    -- Check if category_id column exists in leads table
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'leads' 
        AND column_name = 'category_id'
    ) THEN
        -- Add category_id column if it doesn't exist
        ALTER TABLE public.leads ADD COLUMN category_id INTEGER;
        RAISE NOTICE 'Added category_id column to leads table';
    ELSE
        RAISE NOTICE 'category_id column already exists in leads table';
    END IF;
END $$;

-- Now add the foreign key constraint
-- First drop the constraint if it already exists to avoid errors
DO $$
BEGIN
    -- Check if the foreign key constraint already exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_schema = 'public' 
        AND table_name = 'leads' 
        AND constraint_name = 'fk_leads_category_id'
    ) THEN
        -- Drop existing constraint
        ALTER TABLE public.leads DROP CONSTRAINT fk_leads_category_id;
        RAISE NOTICE 'Dropped existing foreign key constraint fk_leads_category_id';
    END IF;
END $$;

-- Add the foreign key constraint
ALTER TABLE public.leads 
ADD CONSTRAINT fk_leads_category_id 
FOREIGN KEY (category_id) 
REFERENCES public.misc_category(id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Create an index on category_id for better JOIN performance
CREATE INDEX IF NOT EXISTS idx_leads_category_id ON public.leads(category_id);

-- Update any existing leads that have category names in the 'category' column
-- to populate the category_id field
UPDATE public.leads 
SET category_id = mc.id
FROM public.misc_category mc
WHERE public.leads.category = mc.name
AND public.leads.category_id IS NULL;

-- Display some statistics
DO $$
DECLARE
    total_leads INTEGER;
    leads_with_category_id INTEGER;
    leads_with_category_name INTEGER;
BEGIN
    -- Count total leads
    SELECT COUNT(*) INTO total_leads FROM public.leads;
    
    -- Count leads with category_id
    SELECT COUNT(*) INTO leads_with_category_id 
    FROM public.leads 
    WHERE category_id IS NOT NULL;
    
    -- Count leads with category name
    SELECT COUNT(*) INTO leads_with_category_name 
    FROM public.leads 
    WHERE category IS NOT NULL AND category != '';
    
    RAISE NOTICE 'Foreign key setup complete:';
    RAISE NOTICE '  Total leads: %', total_leads;
    RAISE NOTICE '  Leads with category_id: %', leads_with_category_id;
    RAISE NOTICE '  Leads with category name: %', leads_with_category_name;
END $$;

-- Verify the foreign key was created successfully
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
WHERE 
    tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_name = 'leads'
    AND tc.constraint_name = 'fk_leads_category_id';
