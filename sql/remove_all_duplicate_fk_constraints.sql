-- Remove all duplicate foreign key constraints on leads_lead references
-- This script finds tables with multiple FK constraints on the same column
-- and removes duplicates, keeping only one with CASCADE

BEGIN;

-- ============================================
-- Find tables with duplicate foreign key constraints
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    COUNT(*) as constraint_count,
    string_agg(tc.constraint_name, ', ' ORDER BY tc.constraint_name) as constraint_names
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
GROUP BY tc.table_name, kcu.column_name
HAVING COUNT(*) > 1
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- Remove duplicates for meetings table
-- ============================================
DO $$
DECLARE
    constraint_names TEXT[];
    constraint_name TEXT;
    keep_constraint TEXT := 'meetings_legacy_lead_id_fkey'; -- Keep this one
BEGIN
    -- Get all constraint names for meetings.legacy_lead_id
    SELECT array_agg(tc.constraint_name::text ORDER BY tc.constraint_name)
    INTO constraint_names
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'meetings'
      AND kcu.column_name = 'legacy_lead_id'
      AND ccu.table_name = 'leads_lead'
      AND tc.table_schema = 'public';
    
    -- Drop all constraints except the one we want to keep
    IF constraint_names IS NOT NULL THEN
        FOREACH constraint_name IN ARRAY constraint_names
        LOOP
            IF constraint_name != keep_constraint THEN
                EXECUTE format('ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS %I', constraint_name);
                RAISE NOTICE 'Dropped duplicate constraint: %', constraint_name;
            END IF;
        END LOOP;
        
        -- Ensure the kept constraint has CASCADE
        EXECUTE format('ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS %I', keep_constraint);
        EXECUTE format(
            'ALTER TABLE public.meetings ADD CONSTRAINT %I FOREIGN KEY (legacy_lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE',
            keep_constraint
        );
        RAISE NOTICE 'Ensured constraint % has CASCADE', keep_constraint;
    END IF;
END $$;

-- ============================================
-- Remove duplicates for lead_leadcontact table
-- ============================================
DO $$
DECLARE
    constraint_names TEXT[];
    constraint_name TEXT;
    keep_constraint TEXT := 'lead_leadcontact_lead_id_fkey'; -- Keep this one
BEGIN
    -- Get all constraint names for lead_leadcontact.lead_id
    SELECT array_agg(tc.constraint_name::text ORDER BY tc.constraint_name)
    INTO constraint_names
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'lead_leadcontact'
      AND kcu.column_name = 'lead_id'
      AND ccu.table_name = 'leads_lead'
      AND tc.table_schema = 'public';
    
    -- Drop all constraints except the one we want to keep
    IF constraint_names IS NOT NULL AND array_length(constraint_names, 1) > 1 THEN
        FOREACH constraint_name IN ARRAY constraint_names
        LOOP
            IF constraint_name != keep_constraint THEN
                EXECUTE format('ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS %I', constraint_name);
                RAISE NOTICE 'Dropped duplicate constraint: %', constraint_name;
            END IF;
        END LOOP;
        
        -- Ensure the kept constraint has CASCADE
        EXECUTE format('ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS %I', keep_constraint);
        EXECUTE format(
            'ALTER TABLE public.lead_leadcontact ADD CONSTRAINT %I FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE',
            keep_constraint
        );
        RAISE NOTICE 'Ensured constraint % has CASCADE', keep_constraint;
    END IF;
END $$;

-- ============================================
-- Final verification - should show only one constraint per table/column
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    tc.constraint_name,
    rc.delete_rule,
    CASE WHEN rc.delete_rule = 'CASCADE' THEN '✓' ELSE '✗' END as status
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name, tc.constraint_name;

-- ============================================
-- Check for remaining duplicates
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    COUNT(*) as constraint_count
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
GROUP BY tc.table_name, kcu.column_name
HAVING COUNT(*) > 1;

COMMIT;

