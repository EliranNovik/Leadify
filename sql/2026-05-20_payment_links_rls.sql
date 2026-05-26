-- RLS for payment_links (run in Supabase SQL editor after 2026-05-20_payment_links_legacy.sql).
-- Fixes: authenticated staff can create links for legacy rows (client_id NULL, legacy_id set)
-- and anon can read by secure_token for the public /payment/:token page.

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- Replace any existing policies (legacy insert used client_id = 'legacy_*' which failed UUID cast)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_links'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.payment_links', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "payment_links_authenticated_insert"
  ON public.payment_links
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "payment_links_authenticated_select"
  ON public.payment_links
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "payment_links_authenticated_update"
  ON public.payment_links
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Public checkout page loads link by token (no login)
CREATE POLICY "payment_links_anon_select_by_token"
  ON public.payment_links
  FOR SELECT
  TO anon
  USING (secure_token IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON public.payment_links TO authenticated;
GRANT SELECT ON public.payment_links TO anon;
