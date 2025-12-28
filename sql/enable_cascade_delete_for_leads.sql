-- Enable CASCADE DELETE for all foreign keys that reference leads table
-- This allows individual row deletions and TRUNCATE CASCADE to work properly
-- Run this script to update all foreign key constraints for the new leads table

BEGIN;

-- ============================================
-- FIND ALL FOREIGN KEYS REFERENCING leads
-- ============================================
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
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- UPDATE COMMON FOREIGN KEYS TO CASCADE
-- ============================================
-- The script will attempt to update the most common foreign keys
-- Adjust constraint names based on your actual schema

-- 1. contacts table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%lead_id%' 
        AND table_name = 'contacts'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'contacts'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%lead_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.contacts ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated contacts.lead_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 2. meetings table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%client_id%' 
        AND table_name = 'meetings'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'meetings'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%client_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.meetings ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (client_id) REFERENCES public.leads(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated meetings.client_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 3. emails table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%client_id%' 
        AND table_name = 'emails'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'emails'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%client_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.emails ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (client_id) REFERENCES public.leads(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated emails.client_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 4. lead_leadcontact table (newlead_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'lead_leadcontact_newlead_id_fkey' 
        AND table_name = 'lead_leadcontact'
    ) THEN
        ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS lead_leadcontact_newlead_id_fkey;
        ALTER TABLE public.lead_leadcontact 
        ADD CONSTRAINT lead_leadcontact_newlead_id_fkey 
        FOREIGN KEY (newlead_id) 
        REFERENCES public.leads(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated lead_leadcontact.newlead_id foreign key to CASCADE';
    END IF;
END $$;

-- 5. leads_leadstage table (newlead_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_leadstage_newlead_id_fkey' 
        AND table_name = 'leads_leadstage'
    ) THEN
        ALTER TABLE public.leads_leadstage DROP CONSTRAINT IF EXISTS leads_leadstage_newlead_id_fkey;
        ALTER TABLE public.leads_leadstage 
        ADD CONSTRAINT leads_leadstage_newlead_id_fkey 
        FOREIGN KEY (newlead_id) 
        REFERENCES public.leads(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated leads_leadstage.newlead_id foreign key to CASCADE';
    END IF;
END $$;

-- 6. user_highlights table (new_lead_id)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'user_highlights_new_lead_id_fkey' 
        AND table_name = 'user_highlights'
    ) THEN
        ALTER TABLE public.user_highlights DROP CONSTRAINT IF EXISTS user_highlights_new_lead_id_fkey;
        ALTER TABLE public.user_highlights 
        ADD CONSTRAINT user_highlights_new_lead_id_fkey 
        FOREIGN KEY (new_lead_id) 
        REFERENCES public.leads(id) 
        ON DELETE CASCADE;
        RAISE NOTICE 'Updated user_highlights.new_lead_id foreign key to CASCADE';
    END IF;
END $$;

-- 7. payment_plans table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%lead_id%' 
        AND table_name = 'payment_plans'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        DECLARE
            fk_name TEXT;
        BEGIN
            SELECT constraint_name INTO fk_name
            FROM information_schema.table_constraints
            WHERE table_name = 'payment_plans'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%lead_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.payment_plans DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.payment_plans ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated payment_plans.lead_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- 8. contracts table
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%client_id%' 
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
            AND constraint_name LIKE '%client_id%'
            LIMIT 1;
            
            IF fk_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS ' || fk_name;
                EXECUTE 'ALTER TABLE public.contracts ADD CONSTRAINT ' || fk_name || 
                        ' FOREIGN KEY (client_id) REFERENCES public.leads(id) ON DELETE CASCADE';
                RAISE NOTICE 'Updated contracts.client_id foreign key to CASCADE';
            END IF;
        END;
    END IF;
END $$;

-- ============================================
-- VERIFY THE CHANGES
-- ============================================
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
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

COMMIT;

-- ============================================
-- SUMMARY
-- ============================================
-- This script updates all foreign key constraints that reference leads
-- to use ON DELETE CASCADE. This means:
-- - When you delete a row from leads, all related rows in other tables will be automatically deleted
-- - You can now use TRUNCATE TABLE leads CASCADE to delete all rows
-- 
-- WARNING: Be careful with CASCADE deletes - they will permanently delete all related data!

