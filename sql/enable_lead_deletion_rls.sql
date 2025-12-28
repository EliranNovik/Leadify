-- Enable Row Level Security (RLS) and create policies for lead deletion
-- This script creates policies that allow superusers to delete leads from the 'leads' table

BEGIN;

-- ============================================
-- ENABLE RLS ON LEADS TABLE (if not already enabled)
-- ============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

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
WHERE tablename = 'leads' 
  AND cmd = 'DELETE'
ORDER BY policyname;

-- ============================================
-- DROP EXISTING DELETE POLICIES (if any)
-- ============================================
-- Uncomment the line below if you want to replace an existing policy
-- DROP POLICY IF EXISTS "Allow superusers to delete leads" ON leads;

-- ============================================
-- CREATE POLICY: Allow superusers to delete leads
-- ============================================
-- This policy allows users who are superusers (is_superuser = true) to delete any lead
CREATE POLICY "Allow superusers to delete leads"
ON leads
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
-- ALTERNATIVE: Allow authenticated users to delete leads (less restrictive)
-- ============================================
-- If you want to allow all authenticated users to delete leads (not just superusers),
-- uncomment the policy below and comment out the superuser-only policy above
-- 
-- CREATE POLICY "Allow authenticated users to delete leads"
-- ON leads
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
WHERE tablename = 'leads' 
  AND cmd = 'DELETE'
ORDER BY policyname;

-- ============================================
-- TEST THE POLICY (optional - run manually)
-- ============================================
-- To test, try deleting a lead as a superuser:
-- DELETE FROM leads WHERE id = 'your-lead-id-here';
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

