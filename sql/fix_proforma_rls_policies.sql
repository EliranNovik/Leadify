-- Fix RLS policies for proforma tables to allow inserts
-- This allows authenticated users to create proformas and proforma rows

-- Enable RLS on the tables (if not already enabled)
ALTER TABLE public.proformainvoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proformainvoicerow ENABLE ROW LEVEL SECURITY;

-- Drop existing INSERT policies if they exist
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.proformainvoice;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.proformainvoicerow;

-- Create INSERT policy for proformainvoice
CREATE POLICY "Enable insert access for authenticated users" ON public.proformainvoice
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create INSERT policy for proformainvoicerow
-- Allow inserts for authenticated users (the function will ensure data integrity)
CREATE POLICY "Enable insert access for authenticated users" ON public.proformainvoicerow
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Also add UPDATE and DELETE policies if needed
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.proformainvoice;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.proformainvoicerow;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.proformainvoice;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.proformainvoicerow;

-- Create UPDATE policy for proformainvoice
CREATE POLICY "Enable update access for authenticated users" ON public.proformainvoice
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create UPDATE policy for proformainvoicerow
CREATE POLICY "Enable update access for authenticated users" ON public.proformainvoicerow
    FOR UPDATE
    TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM proformainvoice 
            WHERE lead_id IN (
                SELECT id FROM leads_lead
            )
        )
    )
    WITH CHECK (
        invoice_id IN (
            SELECT id FROM proformainvoice 
            WHERE lead_id IN (
                SELECT id FROM leads_lead
            )
        )
    );

-- Create DELETE policy for proformainvoice
CREATE POLICY "Enable delete access for authenticated users" ON public.proformainvoice
    FOR DELETE
    TO authenticated
    USING (true);

-- Create DELETE policy for proformainvoicerow
CREATE POLICY "Enable delete access for authenticated users" ON public.proformainvoicerow
    FOR DELETE
    TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM proformainvoice 
            WHERE lead_id IN (
                SELECT id FROM leads_lead
            )
        )
    );

-- Grant necessary permissions
GRANT INSERT, UPDATE, DELETE ON public.proformainvoice TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.proformainvoicerow TO authenticated;

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
WHERE tablename IN ('proformainvoice', 'proformainvoicerow')
ORDER BY tablename, cmd;

