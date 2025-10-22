-- Fix User ID Data Type Mismatch
-- This script helps understand and fix the mismatch between tenants_employee.user_id and users.id

-- 1. Check the current data types and sample data
SELECT 
    'tenants_employee' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'tenants_employee' 
AND column_name = 'user_id'
AND table_schema = 'public'

UNION ALL

SELECT 
    'users' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name = 'id'
AND table_schema = 'public';

-- 2. Check sample data in tenants_employee.user_id
SELECT 
    'Sample user_id values in tenants_employee' as description,
    user_id,
    display_name,
    COUNT(*) as count
FROM tenants_employee 
WHERE user_id IS NOT NULL
GROUP BY user_id, display_name
ORDER BY user_id
LIMIT 10;

-- 3. Check sample data in users.id
SELECT 
    'Sample id values in users' as description,
    id,
    email,
    first_name
FROM users 
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check if there are any matches between the two tables
-- This will show if any user_id values in tenants_employee match any id values in users
SELECT 
    te.user_id,
    te.display_name,
    u.id as users_id,
    u.email,
    u.first_name,
    'MATCH FOUND' as status
FROM tenants_employee te
JOIN users u ON te.user_id::text = u.id::text
WHERE te.user_id IS NOT NULL
LIMIT 10;

-- 5. Check for potential matches by email (if user_id is actually an employee_id)
-- This assumes that user_id might actually be referencing employee_id or some other field
SELECT 
    te.user_id,
    te.display_name,
    te.email as employee_email,
    u.id as users_id,
    u.email as user_email,
    u.first_name,
    'POTENTIAL EMAIL MATCH' as status
FROM tenants_employee te
LEFT JOIN users u ON LOWER(TRIM(te.email)) = LOWER(TRIM(u.email))
WHERE te.user_id IS NOT NULL
AND u.id IS NOT NULL
LIMIT 10;

-- 6. Count how many employees have user_id values
SELECT 
    COUNT(*) as total_employees,
    COUNT(user_id) as employees_with_user_id,
    COUNT(*) - COUNT(user_id) as employees_without_user_id
FROM tenants_employee;

-- 7. Check if user_id values look like they could be employee IDs
SELECT 
    'user_id values that look like employee IDs' as description,
    user_id,
    display_name,
    id as employee_id,
    CASE 
        WHEN user_id::text = id::text THEN 'user_id matches employee_id'
        ELSE 'user_id does not match employee_id'
    END as comparison
FROM tenants_employee 
WHERE user_id IS NOT NULL
ORDER BY user_id
LIMIT 10;

-- OPTIONS TO FIX THE ISSUE:

-- Option 1: If user_id should reference users.id (UUID), you need to:
-- 1. Change the data type of tenants_employee.user_id to UUID
-- 2. Update the values to match actual user UUIDs

-- Option 2: If user_id should reference a different field in users table:
-- 1. Find the correct field in users table that contains integer values
-- 2. Update the foreign key configuration in the code

-- Option 3: If user_id is not meant to reference users table at all:
-- 1. Remove the foreign key configuration from the code
-- 2. Or change it to reference the correct table

-- Example of how to change the column type (BE CAREFUL - BACKUP FIRST!):
-- ALTER TABLE tenants_employee ALTER COLUMN user_id TYPE UUID USING user_id::text::UUID;

-- Example of how to update values to match users table:
-- UPDATE tenants_employee 
-- SET user_id = u.id::text
-- FROM users u 
-- WHERE tenants_employee.email = u.email;
