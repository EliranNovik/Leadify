-- Sync employee and user relationships
-- This script will match employees with users and populate the foreign key relationships

-- First, let's see the current state of both tables
DO $$
DECLARE
    total_employees INTEGER;
    employees_with_user_id INTEGER;
    total_users INTEGER;
    users_with_employee_id INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_employees FROM public.tenants_employee;
    SELECT COUNT(*) INTO employees_with_user_id FROM public.tenants_employee WHERE user_id IS NOT NULL;
    SELECT COUNT(*) INTO total_users FROM public.users;
    SELECT COUNT(*) INTO users_with_employee_id FROM public.users WHERE employee_id IS NOT NULL;
    
    RAISE NOTICE '=== BEFORE SYNC ===';
    RAISE NOTICE 'Total employees: %', total_employees;
    RAISE NOTICE 'Employees with user_id: %', employees_with_user_id;
    RAISE NOTICE 'Total users: %', total_users;
    RAISE NOTICE 'Users with employee_id: %', users_with_employee_id;
END $$;

-- Show some sample data to understand the matching patterns
SELECT 
    'EMPLOYEES' as table_name,
    display_name as name,
    user_id,
    id as employee_id
FROM public.tenants_employee 
WHERE display_name IS NOT NULL 
ORDER BY display_name 
LIMIT 10;

SELECT 
    'USERS' as table_name,
    COALESCE(full_name, first_name || ' ' || last_name, email) as name,
    employee_id,
    ids as user_id,
    email
FROM public.users 
WHERE email IS NOT NULL 
ORDER BY email 
LIMIT 10;

-- Strategy 1: Match by exact full name
-- Update users.employee_id where full names match exactly
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND te.user_id IS NULL
    AND (
        -- Match full_name with display_name
        TRIM(LOWER(public.users.full_name)) = TRIM(LOWER(te.display_name))
        OR
        -- Match first_name + last_name with display_name
        TRIM(LOWER(public.users.first_name || ' ' || public.users.last_name)) = TRIM(LOWER(te.display_name))
    );

-- Update tenants_employee.user_id for the matched records
UPDATE public.tenants_employee 
SET user_id = u.ids
FROM public.users u
WHERE public.tenants_employee.user_id IS NULL
    AND u.employee_id = public.tenants_employee.id;

-- Strategy 2: Match by email prefix (before @)
-- This matches employees whose display_name contains the email username
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND te.user_id IS NULL
    AND (
        -- Check if employee display_name contains the email username
        LOWER(te.display_name) LIKE '%' || LOWER(SPLIT_PART(public.users.email, '@', 1)) || '%'
        OR
        -- Check if email username contains part of the display_name
        LOWER(SPLIT_PART(public.users.email, '@', 1)) LIKE '%' || LOWER(SPLIT_PART(te.display_name, ' ', 1)) || '%'
    )
    AND LENGTH(SPLIT_PART(public.users.email, '@', 1)) > 3 -- Avoid too short matches
    AND LENGTH(SPLIT_PART(te.display_name, ' ', 1)) > 3; -- Avoid too short matches

-- Update tenants_employee.user_id for the newly matched records
UPDATE public.tenants_employee 
SET user_id = u.ids
FROM public.users u
WHERE public.tenants_employee.user_id IS NULL
    AND u.employee_id = public.tenants_employee.id;

-- Strategy 3: Match by first name similarity
-- Match users where first name appears in employee display_name
UPDATE public.users 
SET employee_id = te.id
FROM public.tenants_employee te
WHERE public.users.employee_id IS NULL
    AND te.user_id IS NULL
    AND public.users.first_name IS NOT NULL
    AND LENGTH(public.users.first_name) > 3
    AND (
        -- First name appears in display_name
        LOWER(te.display_name) LIKE '%' || LOWER(public.users.first_name) || '%'
        OR
        -- Display_name first word matches first_name
        LOWER(SPLIT_PART(te.display_name, ' ', 1)) = LOWER(public.users.first_name)
    );

-- Update tenants_employee.user_id for the newly matched records
UPDATE public.tenants_employee 
SET user_id = u.ids
FROM public.users u
WHERE public.tenants_employee.user_id IS NULL
    AND u.employee_id = public.tenants_employee.id;

-- Show results after automatic matching
DO $$
DECLARE
    total_employees INTEGER;
    employees_with_user_id INTEGER;
    total_users INTEGER;
    users_with_employee_id INTEGER;
    matched_pairs INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_employees FROM public.tenants_employee;
    SELECT COUNT(*) INTO employees_with_user_id FROM public.tenants_employee WHERE user_id IS NOT NULL;
    SELECT COUNT(*) INTO total_users FROM public.users;
    SELECT COUNT(*) INTO users_with_employee_id FROM public.users WHERE employee_id IS NOT NULL;
    SELECT COUNT(*) INTO matched_pairs FROM public.users u 
        JOIN public.tenants_employee te ON u.employee_id = te.id AND te.user_id = u.ids;
    
    RAISE NOTICE '=== AFTER AUTOMATIC MATCHING ===';
    RAISE NOTICE 'Total employees: %', total_employees;
    RAISE NOTICE 'Employees with user_id: %', employees_with_user_id;
    RAISE NOTICE 'Total users: %', total_users;
    RAISE NOTICE 'Users with employee_id: %', users_with_employee_id;
    RAISE NOTICE 'Successfully matched pairs: %', matched_pairs;
END $$;

-- Show successful matches for verification
SELECT 
    u.email,
    u.full_name as user_full_name,
    u.first_name || ' ' || u.last_name as user_first_last,
    te.display_name as employee_display_name,
    u.employee_id,
    te.user_id,
    'MATCHED' as status
FROM public.users u
JOIN public.tenants_employee te ON u.employee_id = te.id AND te.user_id = u.ids
ORDER BY u.email;

-- Show unmatched employees (need manual review)
SELECT 
    te.id as employee_id,
    te.display_name as employee_name,
    'UNMATCHED EMPLOYEE' as status
FROM public.tenants_employee te
WHERE te.user_id IS NULL
    AND te.display_name IS NOT NULL
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
ORDER BY te.display_name;

-- Show unmatched users (need manual review)
SELECT 
    u.ids as user_id,
    u.email,
    u.full_name,
    u.first_name || ' ' || u.last_name as constructed_name,
    'UNMATCHED USER' as status
FROM public.users u
WHERE u.employee_id IS NULL
    AND u.email IS NOT NULL
ORDER BY u.email;

-- Create a helper view for manual matching
CREATE OR REPLACE VIEW employee_user_matching_helper AS
SELECT 
    te.id as employee_id,
    te.display_name as employee_name,
    te.user_id as current_employee_user_id,
    u.ids as user_id,
    u.email as user_email,
    u.full_name as user_full_name,
    u.first_name || ' ' || u.last_name as user_first_last,
    u.employee_id as current_user_employee_id,
    CASE 
        WHEN te.user_id = u.ids AND u.employee_id = te.id THEN 'MATCHED'
        WHEN te.user_id IS NULL AND u.employee_id IS NULL THEN 'BOTH_UNMATCHED'
        WHEN te.user_id IS NULL THEN 'EMPLOYEE_UNMATCHED'
        WHEN u.employee_id IS NULL THEN 'USER_UNMATCHED'
        ELSE 'CONFLICTED'
    END as match_status,
    -- Similarity scoring for manual review
    CASE 
        WHEN LOWER(te.display_name) = LOWER(u.full_name) THEN 100
        WHEN LOWER(te.display_name) = LOWER(u.first_name || ' ' || u.last_name) THEN 95
        WHEN LOWER(te.display_name) LIKE '%' || LOWER(u.first_name) || '%' THEN 80
        WHEN LOWER(u.email) LIKE '%' || LOWER(SPLIT_PART(te.display_name, ' ', 1)) || '%' THEN 70
        WHEN LOWER(SPLIT_PART(te.display_name, ' ', 1)) = LOWER(u.first_name) THEN 60
        ELSE 0
    END as similarity_score
FROM public.tenants_employee te
CROSS JOIN public.users u
WHERE te.display_name IS NOT NULL 
    AND u.email IS NOT NULL
    AND te.display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns')
ORDER BY similarity_score DESC, te.display_name, u.email;

-- Show high-confidence potential matches for manual review
SELECT * FROM employee_user_matching_helper 
WHERE match_status = 'BOTH_UNMATCHED' 
    AND similarity_score >= 60
ORDER BY similarity_score DESC, employee_name;

-- Final summary
DO $$
DECLARE
    total_matched INTEGER;
    total_unmatched_employees INTEGER;
    total_unmatched_users INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_matched 
    FROM public.users u 
    JOIN public.tenants_employee te ON u.employee_id = te.id AND te.user_id = u.ids;
    
    SELECT COUNT(*) INTO total_unmatched_employees 
    FROM public.tenants_employee 
    WHERE user_id IS NULL 
        AND display_name IS NOT NULL
        AND display_name NOT IN ('FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns');
    
    SELECT COUNT(*) INTO total_unmatched_users 
    FROM public.users 
    WHERE employee_id IS NULL;
    
    RAISE NOTICE '=== FINAL SUMMARY ===';
    RAISE NOTICE 'Successfully matched relationships: %', total_matched;
    RAISE NOTICE 'Unmatched employees (need manual review): %', total_unmatched_employees;
    RAISE NOTICE 'Unmatched users (need manual review): %', total_unmatched_users;
    RAISE NOTICE '';
    RAISE NOTICE 'Use this query to see potential matches for manual review:';
    RAISE NOTICE 'SELECT * FROM employee_user_matching_helper WHERE match_status = ''BOTH_UNMATCHED'' AND similarity_score >= 60;';
    RAISE NOTICE '';
    RAISE NOTICE 'To manually match an employee with a user, use:';
    RAISE NOTICE 'UPDATE users SET employee_id = [EMPLOYEE_ID] WHERE ids = [USER_ID];';
    RAISE NOTICE 'UPDATE tenants_employee SET user_id = [USER_ID] WHERE id = [EMPLOYEE_ID];';
END $$;
