-- Enable CASCADE DELETE for all foreign keys that reference leads_lead table
-- This allows individual row deletions and TRUNCATE CASCADE to work properly
-- Run this script to update all foreign key constraints

BEGIN;

-- ============================================
-- FIND ALL FOREIGN KEYS REFERENCING leads_lead
-- ============================================
-- First, let's see what foreign keys currently reference leads_lead
SELECT 
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule AS current_delete_rule,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    -- Generate ALTER statements
    'ALTER TABLE ' || tc.table_schema || '.' || tc.table_name || 
    ' DROP CONSTRAINT ' || tc.constraint_name || ';' AS drop_constraint_stmt,
    'ALTER TABLE ' || tc.table_schema || '.' || tc.table_name || 
    ' ADD CONSTRAINT ' || tc.constraint_name || 
    ' FOREIGN KEY (' || kcu.column_name || ') ' ||
    ' REFERENCES ' || ccu.table_schema || '.' || ccu.table_name || '(' || ccu.column_name || ')' ||
    ' ON DELETE CASCADE;' AS add_cascade_constraint_stmt
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- UPDATE FOREIGN KEYS TO CASCADE
-- ============================================
-- Drop and recreate each foreign key constraint with CASCADE

-- 1. meetings table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'meetings_legacy_lead_id_fkey' 
        AND table_name = 'meetings'
    ) THEN
        ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_legacy_lead_id_fkey;
        ALTER TABLE public.meetings 
        ADD CONSTRAINT meetings_legacy_lead_id_fkey 
        FOREIGN KEY (legacy_lead_id) 
        REFERENCES public.leads_lead(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated meetings.legacy_lead_id foreign key to CASCADE';
    END IF;
END $$;

-- 2. lead_leadcontact table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'lead_leadcontact_lead_id_fkey' 
        AND table_name = 'lead_leadcontact'
    ) THEN
        ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS lead_leadcontact_lead_id_fkey;
        ALTER TABLE public.lead_leadcontact 
        ADD CONSTRAINT lead_leadcontact_lead_id_fkey 
        FOREIGN KEY (lead_id) 
        REFERENCES public.leads_lead(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated lead_leadcontact.lead_id foreign key to CASCADE';
    END IF;
END $$;

-- 3. leads_leadstage table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_leadstage_lead_id_fkey' 
        AND table_name = 'leads_leadstage'
    ) THEN
        ALTER TABLE public.leads_leadstage DROP CONSTRAINT IF EXISTS leads_leadstage_lead_id_fkey;
        ALTER TABLE public.leads_leadstage 
        ADD CONSTRAINT leads_leadstage_lead_id_fkey 
        FOREIGN KEY (lead_id) 
        REFERENCES public.leads_lead(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated leads_leadstage.lead_id foreign key to CASCADE';
    END IF;
END $$;

-- 4. user_highlights table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'user_highlights_lead_id_fkey' 
        AND table_name = 'user_highlights'
    ) THEN
        ALTER TABLE public.user_highlights DROP CONSTRAINT IF EXISTS user_highlights_lead_id_fkey;
        ALTER TABLE public.user_highlights 
        ADD CONSTRAINT user_highlights_lead_id_fkey 
        FOREIGN KEY (lead_id) 
        REFERENCES public.leads_lead(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated user_highlights.lead_id foreign key to CASCADE';
    END IF;
END $$;

-- 5. emails table (if it references leads_lead)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%legacy_id%' 
        AND table_name = 'emails'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        -- Find the exact constraint name
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'emails'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%legacy_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.emails ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (legacy_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated emails.legacy_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 6. finances_paymentplanrow table (if it references leads_lead)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%lead_id%' 
        AND table_name = 'finances_paymentplanrow'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        -- Find the exact constraint name
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'finances_paymentplanrow'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%lead_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.finances_paymentplanrow DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.finances_paymentplanrow ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated finances_paymentplanrow.lead_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 7. contracts table (if it references leads_lead via legacy_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%legacy_id%' 
        AND table_name = 'contracts'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'contracts'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%legacy_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.contracts ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (legacy_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated contracts.legacy_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- ============================================
-- VERIFY THE CHANGES
-- ============================================
-- Check all foreign keys referencing leads_lead and their delete rules
SELECT
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ CASCADE enabled'
        ELSE '✗ No CASCADE (' || rc.delete_rule || ')'
    END as status
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
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- TESTING (uncomment to test)
-- ============================================
-- After running this script, you should be able to:
-- 1. Delete individual rows: DELETE FROM leads_lead WHERE id = 123;
-- 2. Truncate the table: TRUNCATE TABLE leads_lead CASCADE;
--
-- WARNING: CASCADE will delete all related records in dependent tables!

COMMIT;

-- ============================================
-- SUMMARY
-- ============================================
-- This script updates all foreign key constraints that reference leads_lead
-- to use ON DELETE CASCADE. This means:
-- - When you delete a row from leads_lead, all related rows in other tables will be automatically deleted
-- - You can now use TRUNCATE TABLE leads_lead CASCADE to delete all rows
-- 
-- WARNING: Be careful with CASCADE deletes - they will permanently delete all related data!

