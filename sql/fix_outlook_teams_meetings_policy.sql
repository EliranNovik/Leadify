-- Fix RLS policy for outlook_teams_meetings table
-- This allows authenticated users to insert, update, and select their own meetings

-- First, let's check if there are existing policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'outlook_teams_meetings';

-- Drop existing policies if they exist (to start fresh)
DROP POLICY IF EXISTS "Allow authenticated users to insert their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to view their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to update their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to delete their own meetings" ON outlook_teams_meetings;

-- Create comprehensive policies for outlook_teams_meetings table

-- 1. Allow authenticated users to insert meetings they create
CREATE POLICY "Allow authenticated users to insert their own meetings" 
ON outlook_teams_meetings
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid()::text = created_by OR 
  created_by IS NULL OR
  created_by = '' OR
  auth.role() = 'service_role'
);

-- 2. Allow authenticated users to view meetings they created
CREATE POLICY "Allow authenticated users to view their own meetings" 
ON outlook_teams_meetings
FOR SELECT
TO authenticated
USING (
  auth.uid()::text = created_by OR 
  auth.role() = 'service_role'
);

-- 3. Allow authenticated users to update meetings they created
CREATE POLICY "Allow authenticated users to update their own meetings" 
ON outlook_teams_meetings
FOR UPDATE
TO authenticated
USING (
  auth.uid()::text = created_by OR 
  auth.role() = 'service_role'
)
WITH CHECK (
  auth.uid()::text = created_by OR 
  auth.role() = 'service_role'
);

-- 4. Allow authenticated users to delete meetings they created
CREATE POLICY "Allow authenticated users to delete their own meetings" 
ON outlook_teams_meetings
FOR DELETE
TO authenticated
USING (
  auth.uid()::text = created_by OR 
  auth.role() = 'service_role'
);

-- Alternative: If you want to allow all authenticated users to manage all meetings
-- (less secure but simpler for shared calendar management)
-- Uncomment the following if you prefer this approach:

/*
-- Drop the above policies and create more permissive ones
DROP POLICY IF EXISTS "Allow authenticated users to insert their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to view their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to update their own meetings" ON outlook_teams_meetings;
DROP POLICY IF EXISTS "Allow authenticated users to delete their own meetings" ON outlook_teams_meetings;

-- Allow all authenticated users to manage all meetings
CREATE POLICY "Allow all authenticated users to manage meetings" 
ON outlook_teams_meetings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
*/

-- Verify the policies were created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'outlook_teams_meetings'
ORDER BY policyname;

-- Check if RLS is enabled on the table (works in all PostgreSQL versions)
SELECT 
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'outlook_teams_meetings'
  AND c.relkind = 'r';

-- If RLS is not enabled, enable it:
-- ALTER TABLE outlook_teams_meetings ENABLE ROW LEVEL SECURITY;
