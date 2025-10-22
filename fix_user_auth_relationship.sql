-- Fix User Auth Relationship
-- This script helps fix the relationship between Supabase Auth users and the users table

-- 1. First, let's see what's in the users table
SELECT 
    id,
    email,
    first_name,
    auth_id,
    created_at
FROM users 
ORDER BY created_at DESC 
LIMIT 10;

-- 2. Check if there are users with null auth_id
SELECT 
    COUNT(*) as users_with_null_auth_id
FROM users 
WHERE auth_id IS NULL;

-- 3. Check if there are users with auth_id but no matching auth user
-- (This would require checking against auth.users table, which might not be accessible)

-- 4. To fix a specific user, you would run something like this:
-- UPDATE users 
-- SET auth_id = 'your-auth-user-id-here'
-- WHERE email = 'user@example.com';

-- 5. To create a new user record for an auth user that doesn't exist in users table:
-- INSERT INTO users (email, first_name, auth_id, is_active, role, created_at, updated_at)
-- VALUES (
--     'user@example.com',
--     'User First Name',
--     'auth-user-id-here',
--     true,
--     'user',
--     NOW(),
--     NOW()
-- );

-- 6. To find users that might need to be linked:
-- This shows users in the users table that don't have an auth_id
SELECT 
    id,
    email,
    first_name,
    'Missing auth_id - needs to be linked to auth user' as issue
FROM users 
WHERE auth_id IS NULL
ORDER BY created_at DESC;

-- 7. To check the structure of the users table:
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
AND table_schema = 'public'
ORDER BY ordinal_position;
