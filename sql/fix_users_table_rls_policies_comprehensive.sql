-- =============================================
-- Comprehensive Fix for users Table RLS Policies
-- =============================================
-- This fixes all RLS policy issues for users table to support:
-- 1. Login/sidebar functionality (own user data)
-- 2. Messaging system (all users for contacts)
-- 3. Dashboard functionality (user lookups by ID)

-- Enable RLS on users table (if not already enabled)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies to start fresh
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Service role can manage all users" ON public.users;
DROP POLICY IF EXISTS "Users can read all active users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read users" ON public.users;

-- Policy 1: Allow authenticated users to read all users
-- This is needed for messaging contacts and dashboard user lookups
CREATE POLICY "Authenticated users can read users"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Allow users to update their own data
-- This allows users to update their own profile information
CREATE POLICY "Users can update their own data"
ON public.users
FOR UPDATE
TO authenticated
USING (auth.uid() = auth_id)
WITH CHECK (auth.uid() = auth_id);

-- Policy 3: Allow service role to manage all users (for admin operations)
-- This allows backend/admin operations to manage all user records
CREATE POLICY "Service role can manage all users"
ON public.users
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Grant necessary permissions to authenticated users
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE ON public.users TO authenticated;

-- Grant full access to service role
GRANT ALL ON public.users TO service_role;

-- Verify the policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'users' 
ORDER BY policyname;

-- Test query to verify it works
-- This should return all users for authenticated users
SELECT COUNT(*) as total_users FROM public.users WHERE is_active = true;
