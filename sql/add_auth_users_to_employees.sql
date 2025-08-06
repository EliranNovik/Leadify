-- Add all auth users to the employees table
-- This script will fetch all users from auth.users and insert them into the employees table

-- First, let's see what users we have
SELECT 
    id,
    email,
    raw_user_meta_data,
    created_at
FROM auth.users 
WHERE email IS NOT NULL;

-- Insert all auth users into employees table
INSERT INTO employees (
    user_id,
    display_name,
    official_name,
    department_id,
    is_active,
    permissions_level,
    bonuses_role,
    created_at,
    updated_at
)
SELECT 
    au.id as user_id,
    -- Use first name from metadata or email prefix as display name
    COALESCE(
        au.raw_user_meta_data->>'first_name',
        SPLIT_PART(au.email, '@', 1)
    ) as display_name,
    -- Use full name from metadata or email as official name
    COALESCE(
        au.raw_user_meta_data->>'full_name',
        au.raw_user_meta_data->>'first_name' || ' ' || COALESCE(au.raw_user_meta_data->>'last_name', ''),
        au.email
    ) as official_name,
    -- Default to General department
    (SELECT id FROM departments WHERE name = 'General' LIMIT 1) as department_id,
    true as is_active,
    'Access all leads' as permissions_level,
    'One-time bonus (temporary)' as bonuses_role,
    au.created_at,
    au.created_at as updated_at
FROM auth.users au
WHERE au.email IS NOT NULL
    AND au.email NOT LIKE '%@supabase%'  -- Exclude system users
    AND NOT EXISTS (
        -- Don't insert if user already exists in employees table
        SELECT 1 FROM employees e WHERE e.user_id = au.id
    );

-- Show the results
SELECT 
    e.display_name,
    e.official_name,
    e.user_id,
    d.name as department,
    e.is_active,
    e.permissions_level,
    e.bonuses_role,
    e.created_at
FROM employees e
LEFT JOIN departments d ON e.department_id = d.id
ORDER BY e.created_at DESC;

-- Summary
SELECT 
    COUNT(*) as total_employees,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_employees,
    COUNT(CASE WHEN is_manager = true THEN 1 END) as managers,
    COUNT(CASE WHEN is_lawyer = true THEN 1 END) as lawyers
FROM employees; 