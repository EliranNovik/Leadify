-- SQL Policies for tenants_employee table
-- These policies allow authenticated users to read tenants_employee data

-- Enable RLS on tenants_employee table (if not already enabled)
ALTER TABLE tenants_employee ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated users to read all tenants_employee records
-- This is needed for the Employee Performance page and other employee-related features
CREATE POLICY "Allow authenticated users to read tenants_employee" ON tenants_employee
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy 2: Allow authenticated users to read their own tenants_employee record
-- This is a more restrictive policy for user-specific operations
CREATE POLICY "Allow users to read own tenants_employee record" ON tenants_employee
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

-- Policy 3: Allow service role to read all tenants_employee records
-- This is needed for admin operations and data migration
CREATE POLICY "Allow service role to read all tenants_employee" ON tenants_employee
    FOR SELECT
    TO service_role
    USING (true);

-- Policy 4: Allow authenticated users to update their own tenants_employee record
-- This might be needed for profile updates
CREATE POLICY "Allow users to update own tenants_employee record" ON tenants_employee
    FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = user_id::text);

-- Policy 5: Allow service role to update all tenants_employee records
-- This is needed for admin operations
CREATE POLICY "Allow service role to update all tenants_employee" ON tenants_employee
    FOR UPDATE
    TO service_role
    USING (true);

-- Policy 6: Allow service role to insert tenants_employee records
-- This is needed for employee creation
CREATE POLICY "Allow service role to insert tenants_employee" ON tenants_employee
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Policy 7: Allow service role to delete tenants_employee records
-- This is needed for employee deletion (use with caution)
CREATE POLICY "Allow service role to delete tenants_employee" ON tenants_employee
    FOR DELETE
    TO service_role
    USING (true);
