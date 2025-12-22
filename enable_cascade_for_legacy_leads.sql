-- Enable CASCADE DELETE for all foreign keys that reference leads_lead table (legacy leads)
-- This is a dynamic script that will automatically update all foreign keys

BEGIN;

-- ============================================
-- DYNAMIC CASCADE ENABLER FOR leads_lead
-- ============================================

DO $$
DECLARE
    r RECORD;
    constraint_name_var TEXT;
    table_name_var TEXT;
    column_name_var TEXT;
BEGIN
    -- Loop through all foreign keys that reference leads_lead
    FOR r IN (
        SELECT
            tc.constraint_name,
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.delete_rule
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints AS rc
              ON rc.constraint_name = tc.constraint_name
              AND rc.constraint_schema = tc.table_schema
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'leads_lead'
            AND tc.table_schema = 'public'
            AND rc.delete_rule != 'CASCADE'  -- Only update if not already CASCADE
    ) LOOP
        RAISE NOTICE '📝 Processing: %.% (column: %) -> leads_lead | Current rule: %', 
            r.table_schema, r.table_name, r.column_name, r.delete_rule;

        -- Drop the existing foreign key constraint
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I;',
                        r.table_schema, r.table_name, r.constraint_name);
        
        RAISE NOTICE '  ✓ Dropped constraint: %', r.constraint_name;

        -- Recreate the foreign key constraint with ON DELETE CASCADE
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I (%I) ON DELETE CASCADE;',
                        r.table_schema, r.table_name, r.constraint_name, r.column_name,
                        r.foreign_table_schema, r.foreign_table_name, r.foreign_column_name);
        
        RAISE NOTICE '  ✅ Created CASCADE constraint: %', r.constraint_name;
        RAISE NOTICE '';
    END LOOP;
    
    RAISE NOTICE '🎉 All foreign keys updated to CASCADE!';
END;
$$;

-- If everything looks good, commit
COMMIT;

-- ============================================
-- VERIFY THE CHANGES
-- ============================================

SELECT
    tc.table_name,
    kcu.column_name,
    rc.delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ CASCADE enabled'
        WHEN rc.delete_rule = 'SET NULL' THEN '⚠ SET NULL'
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
ORDER BY 
    CASE 
        WHEN rc.delete_rule = 'NO ACTION' THEN 1
        WHEN rc.delete_rule = 'SET NULL' THEN 2
        WHEN rc.delete_rule = 'CASCADE' THEN 3
        ELSE 4
    END,
    tc.table_name;

-- ============================================
-- SUMMARY STATS
-- ============================================

SELECT
    rc.delete_rule,
    COUNT(*) as count,
    string_agg(DISTINCT tc.table_name, ', ' ORDER BY tc.table_name) as affected_tables
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
GROUP BY rc.delete_rule
ORDER BY 
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN 1
        WHEN rc.delete_rule = 'SET NULL' THEN 2
        ELSE 3
    END;

-- ============================================
-- NOW YOU CAN EASILY DELETE LEGACY LEADS
-- ============================================

-- After CASCADE is enabled, you can simply run:
-- DELETE FROM leads_lead;

-- Or delete specific legacy leads:
-- DELETE FROM leads_lead WHERE stage = 91;  -- Example: delete dropped leads
-- DELETE FROM leads_lead WHERE cdate < '2024-01-01';  -- Example: delete old leads
-- DELETE FROM leads_lead WHERE id = 123456;  -- Delete specific lead by ID
-- DELETE FROM leads_lead WHERE manual_id = 'L-123456';  -- Delete by manual_id

