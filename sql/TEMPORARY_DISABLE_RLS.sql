-- =============================================
-- TEMPORARY: Disable RLS for Testing
-- =============================================
-- This will help us determine if RLS is the issue

-- Temporarily disable RLS on leads_lead table
ALTER TABLE public.leads_lead DISABLE ROW LEVEL SECURITY;

-- Keep RLS enabled on users table but with permissive policy
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Ensure users table has the right policy
DROP POLICY IF EXISTS "Authenticated users can read users" ON public.users;
CREATE POLICY "Authenticated users can read users"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- Grant permissions
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.leads_lead TO authenticated;

-- Test the failing query
SELECT COUNT(*) as test_count
FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11' 
  AND next_followup IS NOT NULL 
  AND status = 0 
  AND stage < 100 
  AND (expert_id = 75 OR meeting_manager_id = 75);
