-- =============================================
-- Fix RLS Policies for leads_lead Table
-- =============================================
-- This addresses the 500 errors on leads_lead table queries

-- Check if RLS is enabled on leads_lead table
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'leads_lead' AND schemaname = 'public';

-- If RLS is enabled and causing issues, we might need to adjust policies
-- Let's check existing policies first
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
WHERE tablename = 'leads_lead' 
ORDER BY policyname;

-- If there are restrictive policies causing 500 errors, we can:
-- 1. Temporarily disable RLS for testing
-- 2. Or create more permissive policies

-- Option 1: Temporarily disable RLS (for testing only)
-- ALTER TABLE public.leads_lead DISABLE ROW LEVEL SECURITY;

-- Option 2: Create permissive policy for authenticated users
-- CREATE POLICY "Authenticated users can read leads_lead"
-- ON public.leads_lead
-- FOR SELECT
-- TO authenticated
-- USING (true);

-- Grant permissions
GRANT SELECT ON public.leads_lead TO authenticated;
GRANT ALL ON public.leads_lead TO service_role;
