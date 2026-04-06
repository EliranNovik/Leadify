-- =============================================================================
-- tenants_meetinglocation: allow INSERT/UPDATE/DELETE for authenticated users
-- =============================================================================
-- Problem: RLS was enabled with SELECT-only policies (see fix_tenants_meetinglocation_rls.sql).
-- Admin "Meeting Location" CRUD (GenericCRUDManager) updates return 0 rows → save fails.
--
-- Run this in Supabase SQL Editor (once per project).
-- =============================================================================

ALTER TABLE public.tenants_meetinglocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to insert meeting locations" ON public.tenants_meetinglocation;
DROP POLICY IF EXISTS "Allow authenticated users to update meeting locations" ON public.tenants_meetinglocation;
DROP POLICY IF EXISTS "Allow authenticated users to delete meeting locations" ON public.tenants_meetinglocation;

CREATE POLICY "Allow authenticated users to insert meeting locations"
    ON public.tenants_meetinglocation
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update meeting locations"
    ON public.tenants_meetinglocation
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete meeting locations"
    ON public.tenants_meetinglocation
    FOR DELETE
    TO authenticated
    USING (true);

GRANT INSERT, UPDATE, DELETE ON TABLE public.tenants_meetinglocation TO authenticated;
