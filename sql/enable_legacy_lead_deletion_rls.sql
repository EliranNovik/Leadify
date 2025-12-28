-- Enable Row Level Security (RLS) and create policies for legacy lead deletion
-- This script creates policies that allow superusers to delete leads from the 'leads_lead' table

BEGIN;

-- ============================================
-- ENABLE RLS ON LEADS_LEAD TABLE (if not already enabled)
-- ============================================
ALTER TABLE leads_lead ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CHECK EXISTING DELETE POLICIES
-- ============================================
-- First, let's see what delete policies already exist
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
  AND cmd = 'DELETE'
ORDER BY policyname;

-- ============================================
-- DROP EXISTING DELETE POLICIES (if any)
-- ============================================
-- Uncomment the line below if you want to replace an existing policy
-- DROP POLICY IF EXISTS "Allow superusers to delete legacy leads" ON leads_lead;

-- ============================================
-- CREATE POLICY: Allow superusers to delete legacy leads
-- ============================================
-- This policy allows users who are superusers (is_superuser = true) to delete any legacy lead
CREATE POLICY "Allow superusers to delete legacy leads"
ON leads_lead
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM users 
    WHERE users.auth_id = auth.uid() 
      AND users.is_superuser = true
  )
);

-- ============================================
-- ALTERNATIVE: Allow authenticated users to delete legacy leads (less restrictive)
-- ============================================
-- If you want to allow all authenticated users to delete legacy leads (not just superusers),
-- uncomment the policy below and comment out the superuser-only policy above
-- 
-- CREATE POLICY "Allow authenticated users to delete legacy leads"
-- ON leads_lead
-- FOR DELETE
-- TO authenticated
-- USING (true);

-- ============================================
-- VERIFY THE POLICY WAS CREATED
-- ============================================
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
  AND cmd = 'DELETE'
ORDER BY policyname;

-- ============================================
-- TEST THE POLICY (optional - run manually)
-- ============================================
-- To test, try deleting a legacy lead as a superuser:
-- DELETE FROM leads_lead WHERE id = your-legacy-lead-id-here;
--
-- If you get a permission denied error, the policy isn't working correctly.
-- If the delete succeeds, the policy is working.

COMMIT;

-- ============================================
-- NOTES
-- ============================================
-- 1. This policy requires that the users table has an 'auth_id' column that matches auth.uid()
-- 2. This policy requires that the users table has an 'is_superuser' boolean column
-- 3. Make sure RLS is enabled on the 'users' table as well, or adjust the policy accordingly
-- 4. If your auth setup is different, you may need to adjust the policy condition

