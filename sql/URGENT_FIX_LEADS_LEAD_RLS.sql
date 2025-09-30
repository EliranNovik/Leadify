-- =============================================
-- URGENT FIX: Leads Lead Table RLS Policies
-- =============================================
-- Run this to fix the 500 errors on leads_lead table

-- Step 1: Check current RLS status
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'leads_lead' AND schemaname = 'public';

-- Step 2: Check existing policies
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

-- Step 3: Drop all existing restrictive policies
DROP POLICY IF EXISTS "Users can read their own leads" ON public.leads_lead;
DROP POLICY IF EXISTS "Authenticated users can read leads_lead" ON public.leads_lead;
DROP POLICY IF EXISTS "Service role can manage all leads" ON public.leads_lead;

-- Step 4: Create permissive policy for authenticated users
CREATE POLICY "Authenticated users can read leads_lead"
ON public.leads_lead
FOR SELECT
TO authenticated
USING (true);

-- Step 5: Create policy for service role
CREATE POLICY "Service role can manage all leads"
ON public.leads_lead
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Step 6: Grant permissions
GRANT SELECT ON public.leads_lead TO authenticated;
GRANT ALL ON public.leads_lead TO service_role;

-- Step 7: Test the query
SELECT COUNT(*) as total_leads FROM public.leads_lead WHERE status = 0;
