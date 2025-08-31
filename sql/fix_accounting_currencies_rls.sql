-- Fix RLS policies for accounting_currencies table
-- This allows authenticated and anonymous users to read currency data

-- Enable RLS on the table (if not already enabled)
ALTER TABLE public.accounting_currencies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON public.accounting_currencies;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.accounting_currencies;

-- Create a policy that allows all users (authenticated and anonymous) to read currency data
CREATE POLICY "Enable read access for all users" ON public.accounting_currencies
    FOR SELECT
    TO public
    USING (true);

-- Verify the policy was created
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
WHERE tablename = 'accounting_currencies';
