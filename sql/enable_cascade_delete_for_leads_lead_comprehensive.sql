-- Comprehensive script to enable CASCADE DELETE for ALL foreign keys referencing leads_lead
-- This script will automatically find and update all foreign key constraints
-- Run this to enable TRUNCATE CASCADE and individual row deletions

BEGIN;

-- ============================================
-- STEP 1: Find ALL foreign keys referencing leads_lead
-- ============================================
-- This query shows what will be updated
SELECT 
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule AS current_delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ Already CASCADE'
        ELSE '⚠ Will be updated to CASCADE'
    END as status
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
-- STEP 2: Dynamically update ALL foreign keys to CASCADE
-- ============================================
-- This DO block will find and update all foreign keys automatically
DO $$
DECLARE
    fk_record RECORD;
    drop_stmt TEXT;
    add_stmt TEXT;
    referenced_col TEXT;
BEGIN
    -- Loop through all foreign keys referencing leads_lead
    FOR fk_record IN
        SELECT 
            tc.table_schema,
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            tc.constraint_name,
            ccu.column_name AS referenced_column
        FROM 
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'leads_lead'
            AND tc.table_schema = 'public'
    LOOP
        -- Store the referenced column name
        referenced_col := fk_record.referenced_column;
        
        -- Build DROP CONSTRAINT statement
        drop_stmt := format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            fk_record.table_schema,
            fk_record.referencing_table,
            fk_record.constraint_name
        );
        
        -- Execute DROP
        EXECUTE drop_stmt;
        RAISE NOTICE 'Dropped constraint: % from table: %', 
            fk_record.constraint_name, 
            fk_record.referencing_table;
        
        -- Build ADD CONSTRAINT with CASCADE statement
        add_stmt := format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.leads_lead(%I) ON DELETE CASCADE',
            fk_record.table_schema,
            fk_record.referencing_table,
            fk_record.constraint_name,
            fk_record.referencing_column,
            fk_record.table_schema,
            referenced_col
        );
        
        -- Execute ADD
        EXECUTE add_stmt;
        RAISE NOTICE 'Added CASCADE constraint: % on table: %', 
            fk_record.constraint_name, 
            fk_record.referencing_table;
    END LOOP;
    
    RAISE NOTICE 'Completed updating all foreign key constraints to CASCADE';
END $$;

-- ============================================
-- STEP 3: Verify all constraints now use CASCADE
-- ============================================
SELECT
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ CASCADE enabled'
        ELSE '✗ NOT CASCADE (' || rc.delete_rule || ')'
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
-- STEP 4: Summary
-- ============================================
SELECT
    rc.delete_rule,
    COUNT(*) as constraint_count,
    string_agg(DISTINCT tc.table_name, ', ' ORDER BY tc.table_name) as affected_tables
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
GROUP BY rc.delete_rule
ORDER BY 
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN 1
        ELSE 2
    END;

COMMIT;

-- ============================================
-- AFTER RUNNING THIS SCRIPT:
-- ============================================
-- You should now be able to:
-- 1. Delete individual rows: DELETE FROM leads_lead WHERE id = 123;
-- 2. Truncate the table: TRUNCATE TABLE leads_lead CASCADE;
-- 3. Delete all rows: DELETE FROM leads_lead;
--
-- WARNING: CASCADE will delete all related records in dependent tables!

