-- =============================================================================
-- RLS: firms, channels, firm_contacts (+ lookups / links used by admin CRUD)
-- =============================================================================
-- Run after firms_types_channels_contacts.sql. Adjust policies for your org.
-- Safe to re-run: drops policies by name first.
-- =============================================================================

DROP POLICY IF EXISTS "firms_authenticated_select" ON public.firms;
DROP POLICY IF EXISTS "firms_authenticated_insert" ON public.firms;
DROP POLICY IF EXISTS "firms_authenticated_update" ON public.firms;
DROP POLICY IF EXISTS "firms_authenticated_delete" ON public.firms;

DROP POLICY IF EXISTS "firm_types_authenticated_select" ON public.firm_types;
DROP POLICY IF EXISTS "firm_types_authenticated_insert" ON public.firm_types;
DROP POLICY IF EXISTS "firm_types_authenticated_update" ON public.firm_types;
DROP POLICY IF EXISTS "firm_types_authenticated_delete" ON public.firm_types;

DROP POLICY IF EXISTS "channels_authenticated_select" ON public.channels;
DROP POLICY IF EXISTS "channels_authenticated_insert" ON public.channels;
DROP POLICY IF EXISTS "channels_authenticated_update" ON public.channels;
DROP POLICY IF EXISTS "channels_authenticated_delete" ON public.channels;

DROP POLICY IF EXISTS "firm_firm_type_authenticated_all" ON public.firm_firm_type;
DROP POLICY IF EXISTS "firm_channel_authenticated_all" ON public.firm_channel;

DROP POLICY IF EXISTS "sources_firms_authenticated_all" ON public.sources_firms;

DROP POLICY IF EXISTS "firm_contacts_authenticated_select" ON public.firm_contacts;
DROP POLICY IF EXISTS "firm_contacts_authenticated_insert" ON public.firm_contacts;
DROP POLICY IF EXISTS "firm_contacts_authenticated_update" ON public.firm_contacts;
DROP POLICY IF EXISTS "firm_contacts_authenticated_delete" ON public.firm_contacts;

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_firm_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_contacts ENABLE ROW LEVEL SECURITY;

-- Authenticated full access (tighten to admin role when you have it in JWT / users table)

CREATE POLICY "firms_authenticated_select" ON public.firms FOR SELECT TO authenticated USING (true);
CREATE POLICY "firms_authenticated_insert" ON public.firms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "firms_authenticated_update" ON public.firms FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "firms_authenticated_delete" ON public.firms FOR DELETE TO authenticated USING (true);

CREATE POLICY "firm_types_authenticated_select" ON public.firm_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "firm_types_authenticated_insert" ON public.firm_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "firm_types_authenticated_update" ON public.firm_types FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "firm_types_authenticated_delete" ON public.firm_types FOR DELETE TO authenticated USING (true);

CREATE POLICY "channels_authenticated_select" ON public.channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "channels_authenticated_insert" ON public.channels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "channels_authenticated_update" ON public.channels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "channels_authenticated_delete" ON public.channels FOR DELETE TO authenticated USING (true);

CREATE POLICY "firm_firm_type_authenticated_all" ON public.firm_firm_type FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "firm_channel_authenticated_all" ON public.firm_channel FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "sources_firms_authenticated_all" ON public.sources_firms FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "firm_contacts_authenticated_select" ON public.firm_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "firm_contacts_authenticated_insert" ON public.firm_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "firm_contacts_authenticated_update" ON public.firm_contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "firm_contacts_authenticated_delete" ON public.firm_contacts FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.firms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_firm_type TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_channel TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sources_firms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_contacts TO authenticated;
