-- =============================================
-- COMPLETE RLS FIX FOR ALL TABLES
-- =============================================
-- This fixes both users and leads_lead table RLS issues

-- =============================================
-- FIX USERS TABLE
-- =============================================

-- Drop all existing policies on users table
DROP POLICY IF EXISTS "Users can read their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Service role can manage all users" ON public.users;
DROP POLICY IF EXISTS "Users can read all active users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read users" ON public.users;

-- Create new permissive policy for users table
CREATE POLICY "Authenticated users can read users"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Create update policy for own data
CREATE POLICY "Users can update their own data"
ON public.users
FOR UPDATE
TO authenticated
USING (auth.uid() = auth_id)
WITH CHECK (auth.uid() = auth_id);

-- Grant permissions for users table
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE ON public.users TO authenticated;

-- =============================================
-- FIX LEADS_LEAD TABLE
-- =============================================

-- Drop all existing policies on leads_lead table
DROP POLICY IF EXISTS "Users can read their own leads" ON public.leads_lead;
DROP POLICY IF EXISTS "Authenticated users can read leads_lead" ON public.leads_lead;
DROP POLICY IF EXISTS "Service role can manage all leads" ON public.leads_lead;

-- Create permissive policy for leads_lead table
CREATE POLICY "Authenticated users can read leads_lead"
ON public.leads_lead
FOR SELECT
TO authenticated
USING (true);

-- Grant permissions for leads_lead table
GRANT SELECT ON public.leads_lead TO authenticated;

-- =============================================
-- VERIFICATION
-- =============================================

-- Test users table
SELECT COUNT(*) as total_users FROM public.users;

-- Test leads_lead table
SELECT COUNT(*) as total_leads FROM public.leads_lead WHERE status = 0;

-- Show all policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename IN ('users', 'leads_lead')
ORDER BY tablename, policyname;
