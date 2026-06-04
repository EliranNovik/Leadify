-- Normalized storage for manual interactions on new leads (replaces append-only JSONB races).
-- Existing rows in leads.manual_interactions remain; the app reads both and writes new rows here.

CREATE TABLE IF NOT EXISTS public.lead_manual_interactions (
  id TEXT PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  interaction_date TEXT,
  interaction_time TEXT,
  raw_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  employee TEXT,
  recipient_name TEXT,
  contact_id BIGINT,
  contact_name TEXT,
  content TEXT,
  observation TEXT,
  length TEXT,
  minutes INTEGER,
  editable BOOLEAN NOT NULL DEFAULT TRUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_manual_interactions_lead_id_raw_date
  ON public.lead_manual_interactions (lead_id, raw_date DESC);

CREATE OR REPLACE FUNCTION public.set_lead_manual_interactions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_manual_interactions_updated_at ON public.lead_manual_interactions;
CREATE TRIGGER trg_lead_manual_interactions_updated_at
  BEFORE UPDATE ON public.lead_manual_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lead_manual_interactions_updated_at();

ALTER TABLE public.lead_manual_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_manual_interactions_authenticated_all" ON public.lead_manual_interactions;
CREATE POLICY "lead_manual_interactions_authenticated_all"
  ON public.lead_manual_interactions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_manual_interactions TO authenticated;

COMMENT ON TABLE public.lead_manual_interactions IS
  'Manual CRM interactions for new leads. Legacy copy kept in leads.manual_interactions JSONB until fully migrated.';
