-- Enable RLS and create policy to allow superusers to delete from leads_contact table
-- This is required if RLS is enabled on the table

BEGIN;

-- ============================================
-- Step 1: Check if RLS is enabled
-- ============================================
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename = 'leads_contact';

-- ============================================
-- Step 2: Enable RLS (if not already enabled)
-- ============================================
ALTER TABLE public.leads_contact ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Step 3: Drop existing DELETE policies (if any)
-- ============================================
DROP POLICY IF EXISTS "Allow superusers to delete leads_contact" ON public.leads_contact;
DROP POLICY IF EXISTS "Enable delete for superusers" ON public.leads_contact;
DROP POLICY IF EXISTS "Allow delete for authenticated users" ON public.leads_contact;

-- ============================================
-- Step 4: Create policy to allow superusers to delete
-- ============================================
CREATE POLICY "Allow superusers to delete leads_contact"
ON public.leads_contact
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.users
        WHERE users.auth_id = auth.uid()
        AND users.is_superuser = true
    )
);

-- ============================================
-- Step 5: Also allow delete for postgres role (if running as postgres user)
-- ============================================
-- Note: This allows the postgres role to delete, which is useful when running scripts
-- Remove this if you want to restrict deletion to only authenticated superusers
CREATE POLICY IF NOT EXISTS "Allow postgres role to delete leads_contact"
ON public.leads_contact
FOR DELETE
TO postgres
USING (true);

-- ============================================
-- Step 6: Verify the policies
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
WHERE schemaname = 'public'
AND tablename = 'leads_contact'
ORDER BY policyname;

COMMIT;

-- ============================================
-- Note: If you're still getting JWT errors
-- ============================================
-- The JWT error might be because:
-- 1. You're not authenticated properly in the SQL editor
-- 2. The SQL editor is using a different role than expected
--
-- Try running the DELETE query with the "postgres" role selected in the dropdown
-- Or disable RLS temporarily if you need to do bulk operations:
-- ALTER TABLE public.leads_contact DISABLE ROW LEVEL SECURITY;
-- (Remember to re-enable it afterwards)

