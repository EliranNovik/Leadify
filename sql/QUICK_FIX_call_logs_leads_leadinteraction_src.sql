-- Quick fix: Drop all constraints on call_logs that reference leads_leadinteraction_src
-- Run this before copying data to call_logs

-- Drop all CHECK and FOREIGN KEY constraints that reference the wrong table name
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    -- Drop CHECK constraints
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.call_logs'::regclass
          AND contype = 'c'  -- CHECK constraint
          AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
    LOOP
        EXECUTE format('ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE 'Dropped CHECK constraint: %', constraint_record.conname;
    END LOOP;
    
    -- Drop FOREIGN KEY constraints
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.call_logs'::regclass
          AND contype = 'f'  -- FOREIGN KEY constraint
          AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
    LOOP
        EXECUTE format('ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE 'Dropped FOREIGN KEY constraint: %', constraint_record.conname;
    END LOOP;
    
    -- Also check for singular form without _src
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.call_logs'::regclass
          AND (contype = 'c' OR contype = 'f')
          AND pg_get_constraintdef(oid) LIKE '%leads_leadinteraction"%'  -- Singular form
          AND pg_get_constraintdef(oid) NOT LIKE '%leads_leadinteractions%'  -- But not plural
    LOOP
        EXECUTE format('ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
        RAISE NOTICE 'Dropped constraint (singular form): %', constraint_record.conname;
    END LOOP;
END $$;

-- Verify no problematic constraints remain
SELECT 
    COUNT(*) as remaining_problematic_constraints
FROM 
    pg_constraint
WHERE 
    conrelid = 'public.call_logs'::regclass
    AND (
        pg_get_constraintdef(oid) LIKE '%leads_leadinteraction_src%'
        OR (pg_get_constraintdef(oid) LIKE '%leads_leadinteraction"%' 
            AND pg_get_constraintdef(oid) NOT LIKE '%leads_leadinteractions%')
    );

