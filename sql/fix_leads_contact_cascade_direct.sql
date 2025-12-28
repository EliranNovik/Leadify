-- Direct script to enable CASCADE DELETE for leads_contact table
-- This script directly updates known foreign keys without loops
-- Run this to avoid throttling issues

BEGIN;

-- ============================================
-- Step 1: Find what foreign keys exist first (read-only query)
-- ============================================
-- Run this separately first to see what constraints need updating:
SELECT 
    tc.table_name,
    kcu.column_name,
    tc.constraint_name,
    rc.delete_rule
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
    AND ccu.table_name = 'leads_contact'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- Step 2: Update emails table constraint (most common)
-- ============================================
-- Try common constraint names
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Find the actual constraint name
    SELECT tc.constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'emails'
      AND kcu.column_name LIKE '%contact%'
      AND ccu.table_name = 'leads_contact'
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
    LIMIT 1;
    
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS %I', constraint_name_var);
        EXECUTE format(
            'ALTER TABLE public.emails ADD CONSTRAINT %I FOREIGN KEY (contact_id) REFERENCES public.leads_contact(id) ON DELETE CASCADE',
            constraint_name_var
        );
        RAISE NOTICE 'Updated emails constraint: %', constraint_name_var;
    END IF;
END $$;

-- ============================================
-- Step 3: Update lead_leadcontact table constraint
-- ============================================
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    SELECT tc.constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'lead_leadcontact'
      AND kcu.column_name = 'contact_id'
      AND ccu.table_name = 'leads_contact'
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
    LIMIT 1;
    
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS %I', constraint_name_var);
        EXECUTE format(
            'ALTER TABLE public.lead_leadcontact ADD CONSTRAINT %I FOREIGN KEY (contact_id) REFERENCES public.leads_contact(id) ON DELETE CASCADE',
            constraint_name_var
        );
        RAISE NOTICE 'Updated lead_leadcontact constraint: %', constraint_name_var;
    END IF;
END $$;

-- ============================================
-- Step 4: Verify all constraints are CASCADE
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
    AND ccu.table_name = 'leads_contact'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

COMMIT;

-- ============================================
-- After running:
-- ============================================
-- TRUNCATE TABLE leads_contact CASCADE;
-- OR DELETE FROM leads_contact;

