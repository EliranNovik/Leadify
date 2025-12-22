-- Script to add CASCADE DELETE to all foreign keys referencing the leads table
-- This makes deletion future-proof - deleting a lead will automatically delete all related records

-- STEP 1: Find all foreign keys that reference the leads table
-- Run this first to see what will be changed
SELECT 
    tc.table_schema,
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    tc.constraint_name,
    -- Generate DROP CONSTRAINT statement
    'ALTER TABLE ' || tc.table_schema || '.' || tc.table_name || 
    ' DROP CONSTRAINT ' || tc.constraint_name || ';' AS drop_statement,
    -- Generate ADD CONSTRAINT statement with CASCADE
    'ALTER TABLE ' || tc.table_schema || '.' || tc.table_name || 
    ' ADD CONSTRAINT ' || tc.constraint_name || 
    ' FOREIGN KEY (' || kcu.column_name || ') ' ||
    ' REFERENCES ' || ccu.table_schema || '.' || ccu.table_name || '(' || ccu.column_name || ')' ||
    ' ON DELETE CASCADE;' AS add_cascade_statement
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE 
    tc.constraint_type = 'FOREIGN KEY' 
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- STEP 2: After reviewing the above results, run the statements below
-- These will drop and recreate the foreign keys with CASCADE

-- ============================================
-- AUTOMATED CASCADE ADDITION
-- ============================================

DO $$
DECLARE
    fk_record RECORD;
    drop_stmt TEXT;
    add_stmt TEXT;
BEGIN
    -- Loop through all foreign keys referencing 'leads' table
    FOR fk_record IN 
        SELECT 
            tc.table_name,
            tc.constraint_name,
            kcu.column_name,
            ccu.column_name AS referenced_column
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY' 
            AND ccu.table_name = 'leads'
            AND tc.table_schema = 'public'
    LOOP
        -- Drop existing constraint
        drop_stmt := format('ALTER TABLE %I DROP CONSTRAINT %I',
                           fk_record.table_name,
                           fk_record.constraint_name);
        
        RAISE NOTICE 'Dropping: %', drop_stmt;
        EXECUTE drop_stmt;
        
        -- Add constraint with CASCADE
        add_stmt := format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES leads(id) ON DELETE CASCADE',
                          fk_record.table_name,
                          fk_record.constraint_name,
                          fk_record.column_name);
        
        RAISE NOTICE 'Adding: %', add_stmt;
        EXECUTE add_stmt;
        
        RAISE NOTICE '✓ Updated foreign key: %.% with CASCADE', fk_record.table_name, fk_record.constraint_name;
    END LOOP;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✓ All foreign keys updated with CASCADE';
    RAISE NOTICE '========================================';
END $$;

-- STEP 3: Verify the changes
-- Check that ON DELETE CASCADE is now set
SELECT
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    rc.delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ CASCADE enabled'
        ELSE '✗ No CASCADE'
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
ORDER BY tc.table_name;

