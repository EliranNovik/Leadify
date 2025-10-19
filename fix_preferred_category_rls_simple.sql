-- Simple RLS policy fix for tenant_employee_prefered_category table
-- This script creates the essential RLS policies without complex diagnostics

-- Enable RLS on the table
ALTER TABLE public.tenant_employee_prefered_category ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them properly)
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.tenant_employee_prefered_category;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON public.tenant_employee_prefered_category;

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

-- Grant necessary permissions on the table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_employee_prefered_category TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_employee_prefered_category TO anon;

-- Verify the policies were created successfully
SELECT 
    policyname,
    cmd,
    roles
FROM pg_policies 
WHERE tablename = 'tenant_employee_prefered_category'
ORDER BY policyname;

-- Test query to verify access works
SELECT COUNT(*) as total_records FROM public.tenant_employee_prefered_category;

-- Show sample data if accessible
SELECT * FROM public.tenant_employee_prefered_category LIMIT 5;
