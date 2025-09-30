-- =============================================
-- URGENT FIX: Users Table RLS Policies
-- =============================================
-- Run this immediately to fix the 400 errors on users table

-- Step 1: Drop all existing policies
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Service role can manage all users" ON public.users;
DROP POLICY IF EXISTS "Users can read all active users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read users" ON public.users;

-- Step 2: Create new permissive policy
CREATE POLICY "Authenticated users can read users"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Step 3: Create update policy for own data
CREATE POLICY "Users can update their own data"
ON public.users
FOR UPDATE
TO authenticated
USING (auth.uid() = auth_id)
WITH CHECK (auth.uid() = auth_id);

-- Step 4: Grant permissions
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE ON public.users TO authenticated;

-- Step 5: Verify it worked
SELECT COUNT(*) as total_users FROM public.users;
