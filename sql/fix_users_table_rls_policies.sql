-- =============================================
-- Fix RLS Policies for users Table
-- =============================================
-- This allows users to read their own data from the users table
-- which is necessary for the login and sidebar to display employee information

-- Enable RLS on users table (if not already enabled)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Service role can manage all users" ON public.users;

-- Policy 1: Allow users to read their own data
-- This allows authenticated users to query their own user record
-- using auth.uid() which matches the auth_id column
CREATE POLICY "Users can read their own data"
ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = auth_id);

-- Policy 2: Allow users to update their own data (optional, but good practice)
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
