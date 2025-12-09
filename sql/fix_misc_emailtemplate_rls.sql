-- Fix RLS policies for misc_emailtemplate table
-- This allows authenticated users to read and manage email templates

-- Enable RLS on the table (if not already enabled)
ALTER TABLE public.misc_emailtemplate ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read misc_emailtemplate" ON public.misc_emailtemplate;
DROP POLICY IF EXISTS "Allow authenticated users to insert misc_emailtemplate" ON public.misc_emailtemplate;
DROP POLICY IF EXISTS "Allow authenticated users to update misc_emailtemplate" ON public.misc_emailtemplate;
DROP POLICY IF EXISTS "Allow authenticated users to delete misc_emailtemplate" ON public.misc_emailtemplate;

-- Create policy for read access (SELECT)
CREATE POLICY "Allow authenticated users to read misc_emailtemplate" ON public.misc_emailtemplate
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for insert access (INSERT)
CREATE POLICY "Allow authenticated users to insert misc_emailtemplate" ON public.misc_emailtemplate
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create policy for update access (UPDATE)
CREATE POLICY "Allow authenticated users to update misc_emailtemplate" ON public.misc_emailtemplate
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create policy for delete access (DELETE)
CREATE POLICY "Allow authenticated users to delete misc_emailtemplate" ON public.misc_emailtemplate
    FOR DELETE
    TO authenticated
    USING (true);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.misc_emailtemplate TO authenticated;

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
WHERE tablename = 'misc_emailtemplate';

