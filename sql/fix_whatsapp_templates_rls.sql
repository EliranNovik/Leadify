-- Fix RLS policies for whatsapp_whatsapptemplate table
-- This allows authenticated users to read and manage WhatsApp templates

-- Enable RLS on the table (if not already enabled)
ALTER TABLE public.whatsapp_whatsapptemplate ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.whatsapp_whatsapptemplate;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.whatsapp_whatsapptemplate;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.whatsapp_whatsapptemplate;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.whatsapp_whatsapptemplate;

-- Create policy for read access (SELECT)
CREATE POLICY "Enable read access for authenticated users" ON public.whatsapp_whatsapptemplate
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for insert access (INSERT)
CREATE POLICY "Enable insert access for authenticated users" ON public.whatsapp_whatsapptemplate
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create policy for update access (UPDATE)
CREATE POLICY "Enable update access for authenticated users" ON public.whatsapp_whatsapptemplate
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create policy for delete access (DELETE)
CREATE POLICY "Enable delete access for authenticated users" ON public.whatsapp_whatsapptemplate
    FOR DELETE
    TO authenticated
    USING (true);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_whatsapptemplate TO authenticated;

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
WHERE tablename = 'whatsapp_whatsapptemplate';
