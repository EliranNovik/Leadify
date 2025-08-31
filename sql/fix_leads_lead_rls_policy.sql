-- Fix RLS policy for leads_lead table to allow UPDATE operations

-- First, let's check if there are existing policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'leads_lead';

-- Add UPDATE policy for authenticated users
CREATE POLICY "Enable UPDATE for authenticated users on leads_lead" ON leads_lead
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Alternative: If you want to be more restrictive, you can use:
-- CREATE POLICY "Enable UPDATE for authenticated users on leads_lead" ON leads_lead
--     FOR UPDATE
--     TO authenticated
--     USING (auth.uid() IS NOT NULL)
--     WITH CHECK (auth.uid() IS NOT NULL);

-- If you want to allow all operations (SELECT, INSERT, UPDATE, DELETE) for authenticated users:
-- CREATE POLICY "Enable all operations for authenticated users on leads_lead" ON leads_lead
--     FOR ALL
--     TO authenticated
--     USING (true)
--     WITH CHECK (true);

-- Verify the policy was created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'leads_lead';
