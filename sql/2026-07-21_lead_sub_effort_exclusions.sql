-- Remember intentionally removed sub-effort templates per lead so category
-- auto-provision does not re-insert them. Manual add clears the exclusion.
-- Run in Supabase SQL editor.
--
-- Then run 2026-07-21_lead_sub_efforts_manually_added.sql (portal + manually_added column).

CREATE TABLE IF NOT EXISTS public.lead_sub_effort_exclusions (
  id bigserial PRIMARY KEY,
  legacy_lead_id bigint NULL,
  new_lead_id uuid NULL,
  sub_effort_id bigint NOT NULL REFERENCES public.sub_efforts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_sub_effort_exclusions_lead_chk CHECK (
    (legacy_lead_id IS NOT NULL AND new_lead_id IS NULL)
    OR (legacy_lead_id IS NULL AND new_lead_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sub_effort_exclusions_legacy
  ON public.lead_sub_effort_exclusions (legacy_lead_id, sub_effort_id)
  WHERE legacy_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sub_effort_exclusions_new
  ON public.lead_sub_effort_exclusions (new_lead_id, sub_effort_id)
  WHERE new_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_sub_effort_exclusions_legacy
  ON public.lead_sub_effort_exclusions (legacy_lead_id)
  WHERE legacy_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_sub_effort_exclusions_new
  ON public.lead_sub_effort_exclusions (new_lead_id)
  WHERE new_lead_id IS NOT NULL;

COMMENT ON TABLE public.lead_sub_effort_exclusions IS
  'Templates removed from a lead workflow; category ensure skips these until re-added.';

ALTER TABLE public.lead_sub_effort_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_sub_effort_exclusions_select" ON public.lead_sub_effort_exclusions;
CREATE POLICY "lead_sub_effort_exclusions_select" ON public.lead_sub_effort_exclusions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_sub_effort_exclusions_insert" ON public.lead_sub_effort_exclusions;
CREATE POLICY "lead_sub_effort_exclusions_insert" ON public.lead_sub_effort_exclusions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_sub_effort_exclusions_delete" ON public.lead_sub_effort_exclusions;
CREATE POLICY "lead_sub_effort_exclusions_delete" ON public.lead_sub_effort_exclusions
  FOR DELETE USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, DELETE ON public.lead_sub_effort_exclusions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.lead_sub_effort_exclusions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lead_sub_effort_exclusions_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.lead_sub_effort_exclusions_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
