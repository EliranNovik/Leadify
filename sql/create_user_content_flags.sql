-- =============================================================================
-- Per-user flags for Interactions (email / WhatsApp / phone / manual / legacy)
-- and for arbitrary lead fields (new + legacy leads), e.g. expert_opinion.
-- Run in Supabase SQL Editor. Safe to re-run where noted (IF NOT EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_content_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  flag_kind text NOT NULL CHECK (flag_kind IN ('conversation', 'lead_field')),

  -- Conversation / interaction row (timeline item, synced message, call, etc.)
  conversation_channel text CHECK (
    conversation_channel IS NULL
    OR conversation_channel IN (
      'email',
      'whatsapp',
      'phone',
      'manual',
      'legacy_interaction'
    )
  ),
  -- Stable string id: emails.message_id, whatsapp_messages.id::text, call_logs.id::text,
  -- manual_interactions[].id (new leads), leads_leadinteractions.id::text (legacy), etc.
  external_id text,

  -- Lead field flag (column name on leads or leads_lead — app convention)
  lead_field_key text,

  -- Exactly one lead reference when flagging a lead field; optional context for conversation
  new_lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  legacy_lead_id integer,

  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_content_flags_lead_xor CHECK (
    (new_lead_id IS NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NOT NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  ),

  CONSTRAINT user_content_flags_conversation_shape CHECK (
    flag_kind <> 'conversation'
    OR (
      conversation_channel IS NOT NULL
      AND external_id IS NOT NULL
      AND trim(external_id) <> ''
      AND lead_field_key IS NULL
    )
  ),

  CONSTRAINT user_content_flags_lead_field_shape CHECK (
    flag_kind <> 'lead_field'
    OR (
      lead_field_key IS NOT NULL
      AND trim(lead_field_key) <> ''
      AND conversation_channel IS NULL
      AND external_id IS NULL
      AND new_lead_id IS NOT NULL
      AND legacy_lead_id IS NULL
    )
    OR (
      lead_field_key IS NOT NULL
      AND trim(lead_field_key) <> ''
      AND conversation_channel IS NULL
      AND external_id IS NULL
      AND new_lead_id IS NULL
      AND legacy_lead_id IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.user_content_flags IS
  'Per-user flags: conversation rows (email/whatsapp/phone/manual/legacy interaction) or lead columns (lead_field_key on new or legacy lead).';

COMMENT ON COLUMN public.user_content_flags.conversation_channel IS
  'email=synced mailbox row; whatsapp=whatsapp_messages; phone=call_logs; manual=manual_interactions id (new lead JSON); legacy_interaction=leads_leadinteractions.id';

COMMENT ON COLUMN public.user_content_flags.external_id IS
  'Opaque stable id as string (message_id, numeric row id, manual_*, etc.).';

COMMENT ON COLUMN public.user_content_flags.lead_field_key IS
  'Snake_case column or logical field name, e.g. expert_opinion, facts — app-defined.';

-- Optional FK to legacy leads (skip if leads_lead does not exist in your DB)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads_lead'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'user_content_flags_legacy_lead_id_fkey'
    ) THEN
      ALTER TABLE public.user_content_flags
        ADD CONSTRAINT user_content_flags_legacy_lead_id_fkey
        FOREIGN KEY (legacy_lead_id) REFERENCES public.leads_lead (id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Uniqueness: one row per user per target
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_content_flags_conversation
  ON public.user_content_flags (user_id, conversation_channel, external_id)
  WHERE flag_kind = 'conversation';

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_content_flags_lead_field_new
  ON public.user_content_flags (user_id, new_lead_id, lead_field_key)
  WHERE flag_kind = 'lead_field' AND new_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_content_flags_lead_field_legacy
  ON public.user_content_flags (user_id, legacy_lead_id, lead_field_key)
  WHERE flag_kind = 'lead_field' AND legacy_lead_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Indexes for lookups
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_content_flags_user_kind
  ON public.user_content_flags (user_id, flag_kind);

CREATE INDEX IF NOT EXISTS idx_user_content_flags_user_external
  ON public.user_content_flags (user_id, external_id)
  WHERE flag_kind = 'conversation';

-- -----------------------------------------------------------------------------
-- 4. updated_at trigger (reuse pattern if you have set_updated_at globally)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_content_flags_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_content_flags_updated_at ON public.user_content_flags;
CREATE TRIGGER trg_user_content_flags_updated_at
  BEFORE UPDATE ON public.user_content_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_user_content_flags_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security (same pattern as follow_ups)
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_content_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content flags" ON public.user_content_flags;
DROP POLICY IF EXISTS "Users can insert own content flags" ON public.user_content_flags;
DROP POLICY IF EXISTS "Users can update own content flags" ON public.user_content_flags;
DROP POLICY IF EXISTS "Users can delete own content flags" ON public.user_content_flags;

CREATE POLICY "Users can view own content flags"
  ON public.user_content_flags FOR SELECT
  USING (
    auth.uid() IN (SELECT auth_id FROM public.users u WHERE u.id = user_content_flags.user_id)
  );

CREATE POLICY "Users can insert own content flags"
  ON public.user_content_flags FOR INSERT
  WITH CHECK (
    auth.uid() IN (SELECT auth_id FROM public.users u WHERE u.id = user_content_flags.user_id)
  );

CREATE POLICY "Users can update own content flags"
  ON public.user_content_flags FOR UPDATE
  USING (
    auth.uid() IN (SELECT auth_id FROM public.users u WHERE u.id = user_content_flags.user_id)
  )
  WITH CHECK (
    auth.uid() IN (SELECT auth_id FROM public.users u WHERE u.id = user_content_flags.user_id)
  );

CREATE POLICY "Users can delete own content flags"
  ON public.user_content_flags FOR DELETE
  USING (
    auth.uid() IN (SELECT auth_id FROM public.users u WHERE u.id = user_content_flags.user_id)
  );

-- -----------------------------------------------------------------------------
-- 6. Grants (Supabase: allow API access under RLS)
-- -----------------------------------------------------------------------------
GRANT ALL ON TABLE public.user_content_flags TO authenticated;
GRANT ALL ON TABLE public.user_content_flags TO service_role;
