-- Add foreign key constraint between leads_lead.source_id and misc_leadsource.id
-- This will allow us to properly join the tables and get source names

-- First, let's check if misc_leadsource has a primary key
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name,
    tc.constraint_type
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
WHERE tc.table_name = 'misc_leadsource'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE');

-- Add primary key constraint to misc_leadsource if it doesn't exist
-- Check if primary key already exists first
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'misc_leadsource' 
          AND constraint_type = 'PRIMARY KEY'
          AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.misc_leadsource 
        ADD CONSTRAINT pk_misc_leadsource_id 
        PRIMARY KEY (id);
        RAISE NOTICE 'Primary key constraint added to misc_leadsource';
    ELSE
        RAISE NOTICE 'Primary key constraint already exists on misc_leadsource';
    END IF;
END $$;

-- First, let's check if the foreign key constraint already exists
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
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'leads_lead'
  AND kcu.column_name = 'source_id';

-- Add the foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'leads_lead' 
          AND constraint_name = 'fk_leads_lead_source_id'
          AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD CONSTRAINT fk_leads_lead_source_id 
        FOREIGN KEY (source_id) 
        REFERENCES public.misc_leadsource(id);
        RAISE NOTICE 'Foreign key constraint added between leads_lead.source_id and misc_leadsource.id';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists between leads_lead.source_id and misc_leadsource.id';
    END IF;
END $$;

-- Verify the constraint was added
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
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'leads_lead'
  AND kcu.column_name = 'source_id';
