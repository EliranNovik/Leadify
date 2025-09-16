-- Comprehensive RLS Policies for Employee Performance Page
-- Run these policies in your Supabase SQL editor

-- ========================================
-- AUTH_USER TABLE POLICIES
-- ========================================

-- Enable RLS on auth_user table
ALTER TABLE auth_user ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Allow authenticated users to read auth_user" ON auth_user;
DROP POLICY IF EXISTS "Allow users to read own auth_user record" ON auth_user;
DROP POLICY IF EXISTS "Allow service role to read all auth_user" ON auth_user;
DROP POLICY IF EXISTS "Allow users to update own auth_user record" ON auth_user;
DROP POLICY IF EXISTS "Allow service role to update all auth_user" ON auth_user;
DROP POLICY IF EXISTS "Allow service role to insert auth_user" ON auth_user;
DROP POLICY IF EXISTS "Allow service role to delete auth_user" ON auth_user;

-- Create new policies for auth_user
CREATE POLICY "Allow authenticated users to read auth_user" ON auth_user
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow users to read own auth_user record" ON auth_user
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = id::text);

CREATE POLICY "Allow service role to read all auth_user" ON auth_user
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Allow users to update own auth_user record" ON auth_user
    FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = id::text);

CREATE POLICY "Allow service role to update all auth_user" ON auth_user
    FOR UPDATE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role to insert auth_user" ON auth_user
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role to delete auth_user" ON auth_user
    FOR DELETE
    TO service_role
    USING (true);

-- ========================================
-- TENANTS_EMPLOYEE TABLE POLICIES
-- ========================================

-- Enable RLS on tenants_employee table
ALTER TABLE tenants_employee ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read tenants_employee" ON tenants_employee;
DROP POLICY IF EXISTS "Allow users to read own tenants_employee record" ON tenants_employee;
DROP POLICY IF EXISTS "Allow service role to read all tenants_employee" ON tenants_employee;
DROP POLICY IF EXISTS "Allow users to update own tenants_employee record" ON tenants_employee;
DROP POLICY IF EXISTS "Allow service role to update all tenants_employee" ON tenants_employee;
DROP POLICY IF EXISTS "Allow service role to insert tenants_employee" ON tenants_employee;
DROP POLICY IF EXISTS "Allow service role to delete tenants_employee" ON tenants_employee;

-- Create new policies for tenants_employee
CREATE POLICY "Allow authenticated users to read tenants_employee" ON tenants_employee
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow users to read own tenants_employee record" ON tenants_employee
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

CREATE POLICY "Allow service role to read all tenants_employee" ON tenants_employee
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Allow users to update own tenants_employee record" ON tenants_employee
    FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = user_id::text);

CREATE POLICY "Allow service role to update all tenants_employee" ON tenants_employee
    FOR UPDATE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role to insert tenants_employee" ON tenants_employee
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role to delete tenants_employee" ON tenants_employee
    FOR DELETE
    TO service_role
    USING (true);

-- ========================================
-- TENANT_DEPARTEMENT TABLE POLICIES
-- ========================================

-- Enable RLS on tenant_departement table
ALTER TABLE tenant_departement ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read tenant_departement" ON tenant_departement;
DROP POLICY IF EXISTS "Allow service role to read all tenant_departement" ON tenant_departement;
DROP POLICY IF EXISTS "Allow service role to update all tenant_departement" ON tenant_departement;
DROP POLICY IF EXISTS "Allow service role to insert tenant_departement" ON tenant_departement;
DROP POLICY IF EXISTS "Allow service role to delete tenant_departement" ON tenant_departement;

-- Create new policies for tenant_departement
CREATE POLICY "Allow authenticated users to read tenant_departement" ON tenant_departement
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow service role to read all tenant_departement" ON tenant_departement
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Allow service role to update all tenant_departement" ON tenant_departement
    FOR UPDATE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role to insert tenant_departement" ON tenant_departement
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role to delete tenant_departement" ON tenant_departement
    FOR DELETE
    TO service_role
    USING (true);

-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- Test the policies by running these queries:
-- 1. Check if RLS is enabled on all tables
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('auth_user', 'tenants_employee', 'tenant_departement');

-- 2. Check if policies exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('auth_user', 'tenants_employee', 'tenant_departement')
ORDER BY tablename, policyname;

-- 3. Test data access (run as authenticated user)
-- SELECT COUNT(*) FROM tenants_employee;
-- SELECT COUNT(*) FROM auth_user;
-- SELECT COUNT(*) FROM tenant_departement;
