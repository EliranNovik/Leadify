-- Drop existing policies
DROP POLICY IF EXISTS "Admins can read all access logs" ON access_logs;
DROP POLICY IF EXISTS "Service role can insert access logs" ON access_logs;

-- Create a simpler policy that allows authenticated users to read logs
-- (We'll restrict this to admins in the frontend)
CREATE POLICY "Authenticated users can read access logs" ON access_logs
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Create policy to allow service role to insert logs
CREATE POLICY "Service role can insert access logs" ON access_logs
    FOR INSERT
    WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT ON access_logs TO authenticated;
GRANT INSERT ON access_logs TO service_role;
GRANT USAGE ON SEQUENCE access_logs_id_seq TO service_role;

-- Also grant to anon for testing (remove this in production)
GRANT SELECT ON access_logs TO anon; 