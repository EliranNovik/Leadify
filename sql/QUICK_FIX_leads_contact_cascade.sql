-- QUICK FIX: Enable CASCADE DELETE for leads_contact table
-- Run this script to immediately fix the foreign key constraints
-- This will allow you to delete all rows from leads_contact table

BEGIN;

-- Step 1: Find all foreign keys that need to be updated
SELECT 
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
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
ORDER BY tc.table_name;

-- Step 2: Update ALL foreign keys automatically
DO $$
DECLARE
    rec RECORD;
    drop_sql TEXT;
    add_sql TEXT;
BEGIN
    FOR rec IN
        SELECT 
            tc.table_schema::text as schema_name,
            tc.table_name::text as table_name,
            kcu.column_name::text as column_name,
            tc.constraint_name::text as constraint_name,
            ccu.column_name::text as ref_column
        FROM 
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'leads_contact'
            AND tc.table_schema = 'public'
    LOOP
        -- Drop the constraint
        drop_sql := format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', 
            rec.schema_name, rec.table_name, rec.constraint_name);
        EXECUTE drop_sql;
        
        -- Recreate with CASCADE
        add_sql := format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.leads_contact(%I) ON DELETE CASCADE',
            rec.schema_name, rec.table_name, rec.constraint_name, 
            rec.column_name, rec.schema_name, rec.ref_column
        );
        EXECUTE add_sql;
        
        RAISE NOTICE 'Updated: % on table %', rec.constraint_name, rec.table_name;
    END LOOP;
    
    RAISE NOTICE 'All foreign keys updated to CASCADE';
END $$;

-- Step 3: Remove duplicate constraints
DO $$
DECLARE
    constraint_names TEXT[];
    constraint_name TEXT;
    table_col RECORD;
BEGIN
    FOR table_col IN
        SELECT 
            tc.table_name,
            kcu.column_name,
            array_agg(tc.constraint_name::text ORDER BY tc.constraint_name) as constraint_list
        FROM 
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'leads_contact'
            AND tc.table_schema = 'public'
        GROUP BY tc.table_name, kcu.column_name
        HAVING COUNT(*) > 1
    LOOP
        constraint_names := table_col.constraint_list;
        
        -- Keep the first constraint, drop the rest
        FOR i IN 2..array_length(constraint_names, 1)
        LOOP
            EXECUTE format(
                'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                table_col.table_name,
                constraint_names[i]
            );
            RAISE NOTICE 'Dropped duplicate constraint: % from table: %', 
                constraint_names[i], table_col.table_name;
        END LOOP;
    END LOOP;
END $$;

-- Step 4: Verify all constraints are now CASCADE and no duplicates
SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    rc.delete_rule,
    CASE WHEN rc.delete_rule = 'CASCADE' THEN '✓ OK' ELSE '✗ FAILED' END as status
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
ORDER BY tc.table_name, kcu.column_name, tc.constraint_name;

COMMIT;

-- ============================================
-- AFTER RUNNING THIS SCRIPT:
-- ============================================
-- You can now run:
-- TRUNCATE TABLE leads_contact CASCADE;
-- 
-- OR delete individual rows:
-- DELETE FROM leads_contact WHERE id = 123;
--
-- OR delete all rows:
-- DELETE FROM leads_contact;
--
-- WARNING: This will delete all related records in dependent tables!

