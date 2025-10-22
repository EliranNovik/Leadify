-- Check the current structure of tenants_employee table
-- This will help verify what columns exist and their types

-- Check table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'tenants_employee' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if user_id column exists
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'tenants_employee' 
            AND column_name = 'user_id'
            AND table_schema = 'public'
        ) 
        THEN 'user_id column EXISTS' 
        ELSE 'user_id column DOES NOT EXIST' 
    END as user_id_status;

-- Check foreign key constraints
SELECT 
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name = 'tenants_employee'
AND tc.table_schema = 'public';
