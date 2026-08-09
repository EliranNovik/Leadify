-- PEX: SELECT + INSERT on emails & whatsapp_messages (new leads only)
--
-- Run this if sql/pex_agent_integration.sql was already applied earlier.
-- Safe to re-run (DROP POLICY IF EXISTS + GRANT).
--
-- Matching access model:
--   - anon role (same Supabase anon key shared with PEX)
--   - SELECT all rows
--   - INSERT only when linked to an existing public.leads UUID
--   - No UPDATE / DELETE

-- ---------------------------------------------------------------------------
-- emails
-- ---------------------------------------------------------------------------

ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.emails TO anon;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname = 'emails_id_seq'
  ) THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.emails_id_seq TO anon';
  END IF;
END $$;

DROP POLICY IF EXISTS "pex_select_emails" ON public.emails;
CREATE POLICY "pex_select_emails"
  ON public.emails
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "pex_insert_emails" ON public.emails;
CREATE POLICY "pex_insert_emails"
  ON public.emails
  FOR INSERT
  TO anon
  WITH CHECK (
    client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = client_id)
    AND direction IN ('incoming', 'outgoing')
  );

-- ---------------------------------------------------------------------------
-- whatsapp_messages
-- ---------------------------------------------------------------------------

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.whatsapp_messages TO anon;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname = 'whatsapp_messages_id_seq'
  ) THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_messages_id_seq TO anon';
  END IF;
END $$;

DROP POLICY IF EXISTS "pex_select_whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "pex_select_whatsapp_messages"
  ON public.whatsapp_messages
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "pex_insert_whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "pex_insert_whatsapp_messages"
  ON public.whatsapp_messages
  FOR INSERT
  TO anon
  WITH CHECK (
    lead_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id)
    AND direction IN ('in', 'out')
  );
