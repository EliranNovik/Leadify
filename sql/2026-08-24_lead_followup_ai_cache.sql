-- Cached AI follow-up verdicts (Lead Search sparkles). Separate from leads.ai_summary
-- (Expert Tab notes). One row per lead; regenerated when the source fingerprint changes.

CREATE TABLE IF NOT EXISTS public.lead_followup_ai_cache (
  lead_id text PRIMARY KEY,
  is_legacy boolean NOT NULL DEFAULT false,
  fingerprint text NOT NULL,
  verdict text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  headline text,
  summary text,
  why jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action text,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_name text,
  lead_number text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_followup_ai_cache_generated_at
  ON public.lead_followup_ai_cache (generated_at DESC);

COMMENT ON TABLE public.lead_followup_ai_cache IS
  'Shared Lead Search AI follow-up verdict. Reused when source data fingerprint is unchanged.';

ALTER TABLE public.lead_followup_ai_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_followup_ai_cache_select_auth" ON public.lead_followup_ai_cache;
CREATE POLICY "lead_followup_ai_cache_select_auth" ON public.lead_followup_ai_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_followup_ai_cache_insert_auth" ON public.lead_followup_ai_cache;
CREATE POLICY "lead_followup_ai_cache_insert_auth" ON public.lead_followup_ai_cache
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_followup_ai_cache_update_auth" ON public.lead_followup_ai_cache;
CREATE POLICY "lead_followup_ai_cache_update_auth" ON public.lead_followup_ai_cache
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_followup_ai_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_followup_ai_cache TO service_role;
