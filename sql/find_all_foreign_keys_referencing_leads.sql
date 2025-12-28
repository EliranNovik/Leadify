-- Diagnostic script to find all foreign keys that reference leads or leads_lead tables
-- This helps identify which constraints need to be updated

-- ============================================
-- FOREIGN KEYS REFERENCING leads_lead
-- ============================================
SELECT 
    'leads_lead' AS referenced_table,
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule AS current_delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ Already CASCADE'
        WHEN rc.delete_rule = 'RESTRICT' THEN '✗ RESTRICT (blocks deletion)'
        WHEN rc.delete_rule = 'NO ACTION' THEN '✗ NO ACTION (blocks deletion)'
        WHEN rc.delete_rule = 'SET NULL' THEN '⚠ SET NULL (sets to NULL)'
        ELSE '? ' || rc.delete_rule
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
-- FOREIGN KEYS REFERENCING leads (new leads table)
-- ============================================
SELECT 
    'leads' AS referenced_table,
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    tc.constraint_name,
    rc.delete_rule AS current_delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ Already CASCADE'
        WHEN rc.delete_rule = 'RESTRICT' THEN '✗ RESTRICT (blocks deletion)'
        WHEN rc.delete_rule = 'NO ACTION' THEN '✗ NO ACTION (blocks deletion)'
        WHEN rc.delete_rule = 'SET NULL' THEN '⚠ SET NULL (sets to NULL)'
        ELSE '? ' || rc.delete_rule
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
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- SUMMARY COUNT
-- ============================================
SELECT 
    'leads_lead' AS referenced_table,
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
        WHEN rc.delete_rule = 'SET NULL' THEN 2
        ELSE 3
    END;

SELECT 
    'leads' AS referenced_table,
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
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
GROUP BY rc.delete_rule
ORDER BY 
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN 1
        WHEN rc.delete_rule = 'SET NULL' THEN 2
        ELSE 3
    END;

