-- SQL Policies for auth_user table
-- These policies allow authenticated users to read auth_user data

-- Enable RLS on auth_user table
ALTER TABLE auth_user ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow authenticated users to read all auth_user records
-- This is needed for the Employee Performance page to cross-reference employees with users
CREATE POLICY "Allow authenticated users to read auth_user" ON auth_user
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy 2: Allow authenticated users to read their own auth_user record
-- This is a more restrictive policy for user-specific operations
CREATE POLICY "Allow users to read own auth_user record" ON auth_user
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = id::text);

-- Policy 3: Allow service role to read all auth_user records
-- This is needed for admin operations and data migration
CREATE POLICY "Allow service role to read all auth_user" ON auth_user
    FOR SELECT
    TO service_role
    USING (true);

-- Policy 4: Allow authenticated users to update their own auth_user record
-- This might be needed for profile updates
CREATE POLICY "Allow users to update own auth_user record" ON auth_user
    FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = id::text);

-- Policy 5: Allow service role to update all auth_user records
-- This is needed for admin operations
CREATE POLICY "Allow service role to update all auth_user" ON auth_user
    FOR UPDATE
    TO service_role
    USING (true);

-- Policy 6: Allow service role to insert auth_user records
-- This is needed for user registration
CREATE POLICY "Allow service role to insert auth_user" ON auth_user
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Policy 7: Allow service role to delete auth_user records
-- This is needed for user deletion (use with caution)
CREATE POLICY "Allow service role to delete auth_user" ON auth_user
    FOR DELETE
    TO service_role
    USING (true);
