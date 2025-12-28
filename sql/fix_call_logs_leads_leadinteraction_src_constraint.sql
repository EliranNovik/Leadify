-- Fix constraint on call_logs that references non-existent leads_leadinteraction_src table
-- This script finds and fixes constraints that reference the wrong table name

-- Step 1: Find all constraints on call_logs that reference leads_leadinteraction_src
SELECT 
    tc.constraint_name,
    tc.table_name,
    tc.constraint_type,
    pg_get_constraintdef(c.oid) as constraint_definition
FROM 
    information_schema.table_constraints AS tc
    JOIN pg_constraint c ON c.conname = tc.constraint_name
WHERE 
    tc.table_schema = 'public'
    AND tc.table_name = 'call_logs'
    AND pg_get_constraintdef(c.oid) LIKE '%leads_leadinteraction_src%';

-- Step 2: Find all CHECK constraints on call_logs
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition
FROM 
    pg_constraint
WHERE 
    conrelid = 'public.call_logs'::regclass
    AND contype = 'c'  -- 'c' = CHECK constraint
    AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction%';

-- Step 3: Drop all constraints that reference leads_leadinteraction_src
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    -- Find and drop CHECK constraints that reference leads_leadinteraction_src
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.call_logs'::regclass
          AND contype = 'c'  -- CHECK constraint
          AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
    LOOP
        EXECUTE format('ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE 'Dropped constraint: %', constraint_record.conname;
    END LOOP;
    
    -- Find and drop FOREIGN KEY constraints that reference leads_leadinteraction_src
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.call_logs'::regclass
          AND contype = 'f'  -- FOREIGN KEY constraint
          AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
    LOOP
        EXECUTE format('ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE 'Dropped foreign key constraint: %', constraint_record.conname;
    END LOOP;
END $$;

-- Step 4: Verify all problematic constraints are removed
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition
FROM 
    pg_constraint
WHERE 
    conrelid = 'public.call_logs'::regclass
    AND (
        pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
        OR pg_get_constraintdef(oid) LIKE '%leads_leadinteraction"%'  -- Check for singular without _src
    );

-- Step 5: If call_logs has a lead_interaction_id column, add the correct foreign key
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'call_logs' 
        AND column_name = 'lead_interaction_id'
    ) THEN
        -- Drop any existing constraint with wrong name
        ALTER TABLE public.call_logs 
        DROP CONSTRAINT IF EXISTS call_logs_lead_interaction_id_fkey;
        
        -- Add correct foreign key constraint to leads_leadinteractions
        ALTER TABLE public.call_logs 
        ADD CONSTRAINT call_logs_lead_interaction_id_fkey 
        FOREIGN KEY (lead_interaction_id) 
        REFERENCES public.leads_leadinteractions(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE;
        
        RAISE NOTICE 'Added correct foreign key constraint call_logs_lead_interaction_id_fkey to leads_leadinteractions';
    ELSE
        RAISE NOTICE 'Column lead_interaction_id does not exist in call_logs table';
    END IF;
END $$;

-- Step 6: Final verification - show all constraints on call_logs related to interactions
SELECT 
    tc.constraint_name,
    tc.table_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    pg_get_constraintdef(c.oid) as constraint_definition
FROM 
    information_schema.table_constraints AS tc
    LEFT JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    LEFT JOIN pg_constraint c ON c.conname = tc.constraint_name
WHERE 
    tc.table_schema = 'public'
    AND tc.table_name = 'call_logs'
    AND (
        tc.constraint_name LIKE '%interaction%'
        OR pg_get_constraintdef(c.oid) LIKE '%interaction%'
    );

