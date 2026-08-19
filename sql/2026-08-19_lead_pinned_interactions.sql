-- Team-shared saved (pinned) email / WhatsApp interactions per lead.
-- Run in Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.lead_pinned_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  new_lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  legacy_lead_id integer,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  external_id text NOT NULL,
  subject text,
  preview text,
  direction text CHECK (direction IS NULL OR direction IN ('in', 'out')),
  party_name text,
  occurred_at timestamptz,
  pinned_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  pinned_by_name text,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_pinned_interactions_lead_xor CHECK (
    (new_lead_id IS NOT NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  ),
  CONSTRAINT lead_pinned_interactions_external_id_not_blank CHECK (trim(external_id) <> '')
);

COMMENT ON TABLE public.lead_pinned_interactions IS
  'Saved/pinned email and WhatsApp timeline items for a lead (shared with the team).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads_lead'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'lead_pinned_interactions_legacy_lead_id_fkey'
    ) THEN
      ALTER TABLE public.lead_pinned_interactions
        ADD CONSTRAINT lead_pinned_interactions_legacy_lead_id_fkey
        FOREIGN KEY (legacy_lead_id) REFERENCES public.leads_lead (id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_pinned_interactions_new
  ON public.lead_pinned_interactions (new_lead_id, channel, external_id)
  WHERE new_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_pinned_interactions_legacy
  ON public.lead_pinned_interactions (legacy_lead_id, channel, external_id)
  WHERE legacy_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_pinned_interactions_new_lead
  ON public.lead_pinned_interactions (new_lead_id, pinned_at DESC)
  WHERE new_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_pinned_interactions_legacy_lead
  ON public.lead_pinned_interactions (legacy_lead_id, pinned_at DESC)
  WHERE legacy_lead_id IS NOT NULL;

ALTER TABLE public.lead_pinned_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view lead pinned interactions" ON public.lead_pinned_interactions;
CREATE POLICY "Authenticated can view lead pinned interactions"
  ON public.lead_pinned_interactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can insert lead pinned interactions" ON public.lead_pinned_interactions;
CREATE POLICY "Authenticated can insert lead pinned interactions"
  ON public.lead_pinned_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND pinned_by = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "Authenticated can delete lead pinned interactions" ON public.lead_pinned_interactions;
CREATE POLICY "Authenticated can delete lead pinned interactions"
  ON public.lead_pinned_interactions
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, DELETE ON TABLE public.lead_pinned_interactions TO authenticated;
GRANT ALL ON TABLE public.lead_pinned_interactions TO service_role;
