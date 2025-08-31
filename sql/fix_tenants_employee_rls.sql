-- Fix RLS policies for tenants_employee table
-- This allows authenticated users to read employee data for role dropdowns

-- Enable RLS on the table (if not already enabled)
ALTER TABLE public.tenants_employee ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.tenants_employee;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.tenants_employee;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.tenants_employee;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.tenants_employee;

-- Create policy for read access (SELECT)
CREATE POLICY "Enable read access for authenticated users" ON public.tenants_employee
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for insert access (INSERT)
CREATE POLICY "Enable insert access for authenticated users" ON public.tenants_employee
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create policy for update access (UPDATE)
CREATE POLICY "Enable update access for authenticated users" ON public.tenants_employee
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create policy for delete access (DELETE)
CREATE POLICY "Enable delete access for authenticated users" ON public.tenants_employee
    FOR DELETE
    TO authenticated
    USING (true);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants_employee TO authenticated;

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
WHERE tablename = 'tenants_employee';
