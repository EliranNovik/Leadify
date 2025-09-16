-- SQL Policies for tenant_departement table
-- These policies allow authenticated users to read tenant_departement data

-- Enable RLS on tenant_departement table (if not already enabled)
ALTER TABLE tenant_departement ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated users to read all tenant_departement records
-- This is needed for the Employee Performance page and other department-related features
CREATE POLICY "Allow authenticated users to read tenant_departement" ON tenant_departement
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy 2: Allow service role to read all tenant_departement records
-- This is needed for admin operations and data migration
CREATE POLICY "Allow service role to read all tenant_departement" ON tenant_departement
    FOR SELECT
    TO service_role
    USING (true);

-- Policy 3: Allow service role to update all tenant_departement records
-- This is needed for admin operations
CREATE POLICY "Allow service role to update all tenant_departement" ON tenant_departement
    FOR UPDATE
    TO service_role
    USING (true);

-- Policy 4: Allow service role to insert tenant_departement records
-- This is needed for department creation
CREATE POLICY "Allow service role to insert tenant_departement" ON tenant_departement
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Policy 5: Allow service role to delete tenant_departement records
-- This is needed for department deletion (use with caution)
CREATE POLICY "Allow service role to delete tenant_departement" ON tenant_departement
    FOR DELETE
    TO service_role
    USING (true);
