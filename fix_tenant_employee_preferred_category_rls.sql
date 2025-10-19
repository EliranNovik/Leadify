-- Fix RLS policies for tenant_employee_prefered_category table
-- This script will check and create necessary RLS policies

-- First, let's check if the table exists and what RLS policies are currently applied
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tenant_employee_prefered_category') THEN
        RAISE NOTICE 'Table tenant_employee_prefered_category exists';
    ELSE
        RAISE NOTICE 'Table tenant_employee_prefered_category does not exist';
    END IF;
END $$;

-- Check current RLS status (using correct column names)
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    hasrules
FROM pg_tables 
WHERE tablename = 'tenant_employee_prefered_category';

-- Alternative way to check RLS status
SELECT 
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'tenant_employee_prefered_category'
AND n.nspname = 'public';

-- Check existing policies on the table
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
WHERE tablename = 'tenant_employee_prefered_category';

-- Enable RLS on the table if not already enabled
ALTER TABLE public.tenant_employee_prefered_category ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them properly)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.tenant_employee_prefered_category;

-- Create comprehensive RLS policies for tenant_employee_prefered_category table

-- Policy 1: Allow authenticated users to read all preferred categories
CREATE POLICY "Enable read access for authenticated users" ON public.tenant_employee_prefered_category
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy 2: Allow authenticated users to insert new preferred categories
CREATE POLICY "Enable insert for authenticated users" ON public.tenant_employee_prefered_category
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy 3: Allow authenticated users to update existing preferred categories
CREATE POLICY "Enable update for authenticated users" ON public.tenant_employee_prefered_category
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy 4: Allow authenticated users to delete preferred categories
CREATE POLICY "Enable delete for authenticated users" ON public.tenant_employee_prefered_category
    FOR DELETE
    TO authenticated
    USING (true);

-- Alternative: If you want more restrictive policies, uncomment and use these instead:

-- Restrictive Policy 1: Users can only read their own preferred categories
-- CREATE POLICY "Users can read their own preferred categories" ON public.tenant_employee_prefered_category
--     FOR SELECT
--     TO authenticated
--     USING (
--         empoyee_id IN (
--             SELECT id FROM public.tenants_employee 
--             WHERE user_id = auth.uid()
--         )
--     );

-- Restrictive Policy 2: Users can only insert their own preferred categories
-- CREATE POLICY "Users can insert their own preferred categories" ON public.tenant_employee_prefered_category
--     FOR INSERT
--     TO authenticated
--     WITH CHECK (
--         empoyee_id IN (
--             SELECT id FROM public.tenants_employee 
--             WHERE user_id = auth.uid()
--         )
--     );

-- Restrictive Policy 3: Users can only update their own preferred categories
-- CREATE POLICY "Users can update their own preferred categories" ON public.tenant_employee_prefered_category
--     FOR UPDATE
--     TO authenticated
--     USING (
--         empoyee_id IN (
--             SELECT id FROM public.tenants_employee 
--             WHERE user_id = auth.uid()
--         )
--     )
--     WITH CHECK (
--         empoyee_id IN (
--             SELECT id FROM public.tenants_employee 
--             WHERE user_id = auth.uid()
--         )
--     );

-- Restrictive Policy 4: Users can only delete their own preferred categories
-- CREATE POLICY "Users can delete their own preferred categories" ON public.tenant_employee_prefered_category
--     FOR DELETE
--     TO authenticated
--     USING (
--         empoyee_id IN (
--             SELECT id FROM public.tenants_employee 
--             WHERE user_id = auth.uid()
--         )
--     );

-- Grant necessary permissions on the table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_employee_prefered_category TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_employee_prefered_category TO anon;

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
WHERE tablename = 'tenant_employee_prefered_category'
ORDER BY policyname;

-- Test query to verify access
SELECT COUNT(*) as total_records FROM public.tenant_employee_prefered_category;

-- Show sample data if accessible
SELECT * FROM public.tenant_employee_prefered_category LIMIT 5;
