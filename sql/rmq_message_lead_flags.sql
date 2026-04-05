-- RMQ: flag a chat message and link it to a CRM lead (new UUID or legacy numeric), with flag_types.
-- Run in Supabase SQL Editor after messages / conversations / flag_types exist.

CREATE TABLE IF NOT EXISTS public.rmq_message_lead_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  message_id bigint NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  new_lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  legacy_lead_id integer,
  flag_type bigint NOT NULL DEFAULT 1 REFERENCES public.flag_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rmq_message_lead_flags_lead_one CHECK (
    (new_lead_id IS NOT NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  ),
  CONSTRAINT rmq_message_lead_flags_user_msg UNIQUE (user_id, message_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leads_lead'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'rmq_message_lead_flags_legacy_lead_id_fkey'
    ) THEN
      ALTER TABLE public.rmq_message_lead_flags
        ADD CONSTRAINT rmq_message_lead_flags_legacy_lead_id_fkey
        FOREIGN KEY (legacy_lead_id) REFERENCES public.leads_lead (id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rmq_msg_lead_flags_conv ON public.rmq_message_lead_flags (conversation_id);
CREATE INDEX IF NOT EXISTS idx_rmq_msg_lead_flags_msg ON public.rmq_message_lead_flags (message_id);
CREATE INDEX IF NOT EXISTS idx_rmq_msg_lead_flags_new_lead ON public.rmq_message_lead_flags (new_lead_id) WHERE new_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rmq_msg_lead_flags_legacy ON public.rmq_message_lead_flags (legacy_lead_id) WHERE legacy_lead_id IS NOT NULL;

ALTER TABLE public.rmq_message_lead_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rmq_msg_flags_select_participants" ON public.rmq_message_lead_flags;
CREATE POLICY "rmq_msg_flags_select_participants"
  ON public.rmq_message_lead_flags FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = rmq_message_lead_flags.conversation_id
        AND cp.user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
        AND cp.is_active = true
    )
  );

DROP POLICY IF EXISTS "rmq_msg_flags_insert_own_participant" ON public.rmq_message_lead_flags;
CREATE POLICY "rmq_msg_flags_insert_own_participant"
  ON public.rmq_message_lead_flags FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = rmq_message_lead_flags.conversation_id
        AND cp.user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
        AND cp.is_active = true
    )
  );

DROP POLICY IF EXISTS "rmq_msg_flags_delete_own" ON public.rmq_message_lead_flags;
CREATE POLICY "rmq_msg_flags_delete_own"
  ON public.rmq_message_lead_flags FOR DELETE TO authenticated
  USING (
    user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
  );

GRANT SELECT, INSERT, DELETE ON public.rmq_message_lead_flags TO authenticated;
GRANT ALL ON public.rmq_message_lead_flags TO service_role;

COMMENT ON TABLE public.rmq_message_lead_flags IS
  'User flags an RMQ message and associates it with a lead + flag_types row; visible to all conversation participants.';

-- Count flags for a lead (all users) — for ClientHeader badge; bypasses per-user RLS on detail.
CREATE OR REPLACE FUNCTION public.rmq_flag_count_for_lead(
  p_new_lead_id uuid,
  p_legacy_lead_id integer
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint
  FROM public.rmq_message_lead_flags f
  WHERE
    (p_new_lead_id IS NOT NULL AND f.new_lead_id = p_new_lead_id)
    OR (p_legacy_lead_id IS NOT NULL AND f.legacy_lead_id = p_legacy_lead_id);
$$;

GRANT EXECUTE ON FUNCTION public.rmq_flag_count_for_lead(uuid, integer) TO authenticated;
