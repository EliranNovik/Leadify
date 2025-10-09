-- Check the data formats in role columns to determine if they store IDs or names
-- This will help us understand whether to create foreign key constraints

-- 1. Check case_handler_id data format
SELECT 
    'case_handler_id' as column_name,
    COUNT(*) as total_records,
    COUNT(case_handler_id) as non_null_records,
    COUNT(DISTINCT case_handler_id) as unique_values,
    MIN(LENGTH(case_handler_id::text)) as min_length,
    MAX(LENGTH(case_handler_id::text)) as max_length,
    CASE 
        WHEN case_handler_id ~ '^[0-9]+$' THEN 'Numeric IDs'
        ELSE 'Text/Names'
    END as data_type_sample
FROM leads_lead 
WHERE case_handler_id IS NOT NULL
GROUP BY CASE WHEN case_handler_id ~ '^[0-9]+$' THEN 'Numeric IDs' ELSE 'Text/Names' END;

-- 2. Check expert_id data format
SELECT 
    'expert_id' as column_name,
    COUNT(*) as total_records,
    COUNT(expert_id) as non_null_records,
    COUNT(DISTINCT expert_id) as unique_values,
    MIN(LENGTH(expert_id::text)) as min_length,
    MAX(LENGTH(expert_id::text)) as max_length,
    CASE 
        WHEN expert_id ~ '^[0-9]+$' THEN 'Numeric IDs'
        ELSE 'Text/Names'
    END as data_type_sample
FROM leads_lead 
WHERE expert_id IS NOT NULL
GROUP BY CASE WHEN expert_id ~ '^[0-9]+$' THEN 'Numeric IDs' ELSE 'Text/Names' END;

-- 3. Check closer_id data format
SELECT 
    'closer_id' as column_name,
    COUNT(*) as total_records,
    COUNT(closer_id) as non_null_records,
    COUNT(DISTINCT closer_id) as unique_values,
    MIN(LENGTH(closer_id::text)) as min_length,
    MAX(LENGTH(closer_id::text)) as max_length,
    CASE 
        WHEN closer_id ~ '^[0-9]+$' THEN 'Numeric IDs'
        ELSE 'Text/Names'
    END as data_type_sample
FROM leads_lead 
WHERE closer_id IS NOT NULL
GROUP BY CASE WHEN closer_id ~ '^[0-9]+$' THEN 'Numeric IDs' ELSE 'Text/Names' END;

-- 4. Check meeting_scheduler_id data format
SELECT 
    'meeting_scheduler_id' as column_name,
    COUNT(*) as total_records,
    COUNT(meeting_scheduler_id) as non_null_records,
    COUNT(DISTINCT meeting_scheduler_id) as unique_values,
    MIN(LENGTH(meeting_scheduler_id::text)) as min_length,
    MAX(LENGTH(meeting_scheduler_id::text)) as max_length,
    CASE 
        WHEN meeting_scheduler_id ~ '^[0-9]+$' THEN 'Numeric IDs'
        ELSE 'Text/Names'
    END as data_type_sample
FROM leads_lead 
WHERE meeting_scheduler_id IS NOT NULL
GROUP BY CASE WHEN meeting_scheduler_id ~ '^[0-9]+$' THEN 'Numeric IDs' ELSE 'Text/Names' END;

-- 5. Check meeting_manager_id data format
SELECT 
    'meeting_manager_id' as column_name,
    COUNT(*) as total_records,
    COUNT(meeting_manager_id) as non_null_records,
    COUNT(DISTINCT meeting_manager_id) as unique_values,
    MIN(LENGTH(meeting_manager_id::text)) as min_length,
    MAX(LENGTH(meeting_manager_id::text)) as max_length,
    CASE 
        WHEN meeting_manager_id ~ '^[0-9]+$' THEN 'Numeric IDs'
        ELSE 'Text/Names'
    END as data_type_sample
FROM leads_lead 
WHERE meeting_manager_id IS NOT NULL
GROUP BY CASE WHEN meeting_manager_id ~ '^[0-9]+$' THEN 'Numeric IDs' ELSE 'Text/Names' END;

-- 6. Sample actual values from each column
SELECT 'case_handler_id samples:' as info;
SELECT DISTINCT case_handler_id FROM leads_lead WHERE case_handler_id IS NOT NULL LIMIT 10;

SELECT 'expert_id samples:' as info;
SELECT DISTINCT expert_id FROM leads_lead WHERE expert_id IS NOT NULL LIMIT 10;

SELECT 'closer_id samples:' as info;
SELECT DISTINCT closer_id FROM leads_lead WHERE closer_id IS NOT NULL LIMIT 10;

SELECT 'meeting_scheduler_id samples:' as info;
SELECT DISTINCT meeting_scheduler_id FROM leads_lead WHERE meeting_scheduler_id IS NOT NULL LIMIT 10;

SELECT 'meeting_manager_id samples:' as info;
SELECT DISTINCT meeting_manager_id FROM leads_lead WHERE meeting_manager_id IS NOT NULL LIMIT 10;
