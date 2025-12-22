-- Find all foreign key relationships that reference leads_lead table (legacy leads)
-- This will show which tables will be affected when deleting legacy leads

SELECT
    json_build_object(
        'relationship_type', 'REFERENCES leads_lead',
        'related_table', tc.table_name,
        'column_name', kcu.column_name,
        'current_delete_rule', rc.delete_rule,
        'deletion_behavior', 
            CASE 
                WHEN rc.delete_rule = 'CASCADE' THEN '✓ Will auto-delete'
                WHEN rc.delete_rule = 'SET NULL' THEN '⚠ Will set to NULL'
                WHEN rc.delete_rule = 'NO ACTION' THEN '✗ Will block deletion'
                WHEN rc.delete_rule = 'RESTRICT' THEN '✗ Will block deletion'
                ELSE '? Unknown: ' || rc.delete_rule
            END
    ) as relationship_info
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
ORDER BY 
    tc.table_name, 
    kcu.column_name;

-- Summary of relationships
SELECT
    rc.delete_rule,
    COUNT(*) as count,
    string_agg(DISTINCT tc.table_name, ', ' ORDER BY tc.table_name) as tables
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
        WHEN rc.delete_rule = 'NO ACTION' THEN 1
        WHEN rc.delete_rule = 'RESTRICT' THEN 2
        WHEN rc.delete_rule = 'SET NULL' THEN 3
        WHEN rc.delete_rule = 'CASCADE' THEN 4
        ELSE 5
    END;

