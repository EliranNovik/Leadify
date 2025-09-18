-- Populate users.employee_id column with data from tenants_employee.user_id
-- Match employees by name with users (full_name)

-- First, let's see the current state
DO $$
DECLARE
    total_users INTEGER;
    users_with_employee_id INTEGER;
    total_employees INTEGER;
    employees_with_user_id INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM public.users;
    SELECT COUNT(*) INTO users_with_employee_id FROM public.users WHERE employee_id IS NOT NULL;
    SELECT COUNT(*) INTO total_employees FROM public.tenants_employee;
    SELECT COUNT(*) INTO employees_with_user_id FROM public.tenants_employee WHERE user_id IS NOT NULL;
    
    RAISE NOTICE '=== BEFORE MIGRATION ===';
    RAISE NOTICE 'Total users: %', total_users;
    RAISE NOTICE 'Users with employee_id: %', users_with_employee_id;
    RAISE NOTICE 'Total employees: %', total_employees;
    RAISE NOTICE 'Employees with user_id: %', employees_with_user_id;
END $$;

-- Show sample data to understand the matching
SELECT 
    'SAMPLE USERS' as type,
    ids as user_id,
    email,
    full_name,
    first_name || ' ' || last_name as constructed_name,
    employee_id as current_employee_id
FROM public.users 
WHERE full_name IS NOT NULL 
ORDER BY full_name 
LIMIT 5;

SELECT 
    'SAMPLE EMPLOYEES' as type,
    id as employee_id,
    display_name,
    user_id as current_user_id
FROM public.tenants_employee 
WHERE display_name IS NOT NULL 
    AND display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
ORDER BY display_name 
LIMIT 5;

-- Show potential matches before updating
SELECT 
    u.ids as user_id,
    u.email,
    u.full_name as user_name,
    te.id as employee_id,
    te.display_name as employee_name,
    te.user_id as employee_user_id_value,
    'WILL_MATCH' as action
FROM public.users u
JOIN public.tenants_employee te ON (
    TRIM(LOWER(u.full_name)) = TRIM(LOWER(te.display_name))
    OR 
    TRIM(LOWER(u.first_name || ' ' || u.last_name)) = TRIM(LOWER(te.display_name))
)
WHERE u.employee_id IS NULL
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
ORDER BY u.full_name;

-- Strategy 1: Exact name matching (full_name = display_name)
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND TRIM(LOWER(public.users.full_name)) = TRIM(LOWER(te.display_name))
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns');

-- Strategy 2: Constructed name matching (first_name + last_name = display_name)
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND public.users.first_name IS NOT NULL 
    AND public.users.last_name IS NOT NULL
    AND TRIM(LOWER(public.users.first_name || ' ' || public.users.last_name)) = TRIM(LOWER(te.display_name))
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns');

-- Strategy 3: Partial name matching (for slight variations)
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND (
        -- Display name contains full name
        LOWER(te.display_name) LIKE '%' || LOWER(public.users.full_name) || '%'
        OR
        -- Full name contains display name  
        LOWER(public.users.full_name) LIKE '%' || LOWER(te.display_name) || '%'
        OR
        -- First name match with display name
        (public.users.first_name IS NOT NULL AND 
         LOWER(te.display_name) LIKE '%' || LOWER(public.users.first_name) || '%' AND
         LENGTH(public.users.first_name) > 3)
    )
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
    AND LENGTH(te.display_name) > 3; -- Avoid too generic matches

-- Show results after migration
DO $$
DECLARE
    total_users INTEGER;
    users_with_employee_id INTEGER;
    successful_matches INTEGER;
    remaining_unmatched_users INTEGER;
    remaining_unmatched_employees INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM public.users;
    SELECT COUNT(*) INTO users_with_employee_id FROM public.users WHERE employee_id IS NOT NULL;
    
    -- Count successful bidirectional matches
    SELECT COUNT(*) INTO successful_matches 
    FROM public.users u
    JOIN public.tenants_employee te ON u.employee_id = te.id;
    
    SELECT COUNT(*) INTO remaining_unmatched_users 
    FROM public.users WHERE employee_id IS NULL;
    
    SELECT COUNT(*) INTO remaining_unmatched_employees 
    FROM public.tenants_employee 
    WHERE user_id IS NULL 
        AND display_name IS NOT NULL
        AND display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns');
    
    RAISE NOTICE '=== AFTER MIGRATION ===';
    RAISE NOTICE 'Total users: %', total_users;
    RAISE NOTICE 'Users with employee_id: %', users_with_employee_id;
    RAISE NOTICE 'Successful matches: %', successful_matches;
    RAISE NOTICE 'Remaining unmatched users: %', remaining_unmatched_users;
    RAISE NOTICE 'Remaining unmatched employees: %', remaining_unmatched_employees;
END $$;

-- Show successful matches
SELECT 
    u.email,
    u.full_name as user_name,
    te.display_name as employee_name,
    u.employee_id,
    te.id as employee_table_id,
    'SUCCESS' as status
FROM public.users u
JOIN public.tenants_employee te ON u.employee_id = te.id
ORDER BY u.full_name;

-- Show remaining unmatched users for manual review
SELECT 
    ids as user_id,
    email,
    full_name,
    first_name || ' ' || last_name as constructed_name,
    'NEEDS_MANUAL_MATCH' as status
FROM public.users 
WHERE employee_id IS NULL
ORDER BY full_name;

-- Show remaining unmatched employees for manual review  
SELECT 
    id as employee_id,
    display_name,
    user_id as current_user_id,
    'NEEDS_MANUAL_MATCH' as status
FROM public.tenants_employee 
WHERE display_name IS NOT NULL
    AND display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
    AND id NOT IN (SELECT employee_id FROM public.users WHERE employee_id IS NOT NULL)
ORDER BY display_name;
