-- Enable RLS on tenants_meetinglocation table
ALTER TABLE public.tenants_meetinglocation ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to read all meeting locations
CREATE POLICY "Allow authenticated users to read meeting locations" ON public.tenants_meetinglocation
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy for service role to read all meeting locations
CREATE POLICY "Allow service role to read meeting locations" ON public.tenants_meetinglocation
    FOR SELECT
    TO service_role
    USING (true);

-- Create policy for anon users to read all meeting locations (if needed for public access)
CREATE POLICY "Allow anon users to read meeting locations" ON public.tenants_meetinglocation
    FOR SELECT
    TO anon
    USING (true);

-- Write policies: run sql/tenants_meetinglocation_rls_write_policies.sql in Supabase (idempotent).
-- Or uncomment the block below if applying this file as a one-off:

-- DROP POLICY IF EXISTS "Allow authenticated users to insert meeting locations" ON public.tenants_meetinglocation;
-- CREATE POLICY "Allow authenticated users to insert meeting locations" ON public.tenants_meetinglocation
--     FOR INSERT TO authenticated WITH CHECK (true);
-- DROP POLICY IF EXISTS "Allow authenticated users to update meeting locations" ON public.tenants_meetinglocation;
-- CREATE POLICY "Allow authenticated users to update meeting locations" ON public.tenants_meetinglocation
--     FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "Allow authenticated users to delete meeting locations" ON public.tenants_meetinglocation;
-- CREATE POLICY "Allow authenticated users to delete meeting locations" ON public.tenants_meetinglocation
--     FOR DELETE TO authenticated USING (true);
-- GRANT INSERT, UPDATE, DELETE ON TABLE public.tenants_meetinglocation TO authenticated;
