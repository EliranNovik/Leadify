-- Add foreign key constraints for stage and language in leads_lead table
-- This will allow proper joins for stage and language names

-- Check current constraints
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name,
    tc.constraint_type,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    LEFT JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'leads_lead'
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
ORDER BY tc.constraint_type, kcu.column_name;

-- Check if lead_stages table has primary key
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
WHERE tc.table_name = 'lead_stages'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.constraint_type, kcu.column_name;

-- Check if misc_language table has primary key
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
WHERE tc.table_name = 'misc_language'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.constraint_type, kcu.column_name;

-- Add primary key to lead_stages if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'lead_stages' 
          AND constraint_type = 'PRIMARY KEY'
          AND table_schema = 'public'
    ) THEN
        -- Try to add primary key on id column
        ALTER TABLE public.lead_stages 
        ADD CONSTRAINT pk_lead_stages_id 
        PRIMARY KEY (id);
        RAISE NOTICE 'Primary key constraint added to lead_stages';
    ELSE
        RAISE NOTICE 'Primary key constraint already exists on lead_stages';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add primary key to lead_stages: %', SQLERRM;
END $$;

-- Add primary key to misc_language if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'misc_language' 
          AND constraint_type = 'PRIMARY KEY'
          AND table_schema = 'public'
    ) THEN
        -- Try to add primary key on id column
        ALTER TABLE public.misc_language 
        ADD CONSTRAINT pk_misc_language_id 
        PRIMARY KEY (id);
        RAISE NOTICE 'Primary key constraint added to misc_language';
    ELSE
        RAISE NOTICE 'Primary key constraint already exists on misc_language';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add primary key to misc_language: %', SQLERRM;
END $$;

-- Add foreign key constraint for stage (leads_lead.stage -> lead_stages.id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'leads_lead' 
          AND constraint_name = 'fk_leads_lead_stage'
          AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD CONSTRAINT fk_leads_lead_stage 
        FOREIGN KEY (stage) 
        REFERENCES public.lead_stages(id);
        RAISE NOTICE 'Foreign key constraint added between leads_lead.stage and lead_stages.id';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists between leads_lead.stage and lead_stages.id';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add stage foreign key: %', SQLERRM;
END $$;

-- Add foreign key constraint for language (leads_lead.language_id -> misc_language.id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'leads_lead' 
          AND constraint_name = 'fk_leads_lead_language_id'
          AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD CONSTRAINT fk_leads_lead_language_id 
        FOREIGN KEY (language_id) 
        REFERENCES public.misc_language(id);
        RAISE NOTICE 'Foreign key constraint added between leads_lead.language_id and misc_language.id';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists between leads_lead.language_id and misc_language.id';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add language foreign key: %', SQLERRM;
END $$;

-- Verify all constraints were added
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name,
    tc.constraint_type,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    LEFT JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'leads_lead'
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
ORDER BY tc.constraint_type, kcu.column_name;
