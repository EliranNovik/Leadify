-- =============================================
-- DEBUG: Check RLS Status and Policies
-- =============================================

-- Check if RLS is enabled on both tables
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename IN ('users', 'leads_lead') 
  AND schemaname = 'public';

-- Check all existing policies
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
WHERE tablename IN ('users', 'leads_lead')
ORDER BY tablename, policyname;

-- Test simple queries
SELECT 'Users count: ' || COUNT(*) as test FROM public.users;
SELECT 'Leads count: ' || COUNT(*) as test FROM public.leads_lead;

-- Test the specific query that's failing
SELECT COUNT(*) as leads_with_followup 
FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11' 
  AND next_followup IS NOT NULL 
  AND status = 0 
  AND stage < 100 
  AND (expert_id = 75 OR meeting_manager_id = 75);
