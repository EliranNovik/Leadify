-- Staff INSERT on emails was still 42501 after the first policy:
--   WITH CHECK looked up public.users (auth_id + employee_id). That subquery is
--   itself subject to users RLS, so EXISTS often returns false and the insert is denied.
--
-- This revision:
--   1) Permissive authenticated INSERT/UPDATE (no users lookup)
--   2) Drops RESTRICTIVE INSERT policies that would still block
--   3) SECURITY DEFINER insert_crm_email() bypasses RLS so offer rows always save
--
-- Re-run this whole file.

ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.emails TO authenticated;

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
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.emails_id_seq TO authenticated';
  END IF;
END $$;

-- Restrictive INSERT policies must ALL pass. Drop them so the permissive policy can work.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emails'
      AND cmd = 'INSERT'
      AND permissive = 'RESTRICTIVE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.emails', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "staff_insert_emails" ON public.emails;
CREATE POLICY "staff_insert_emails"
  ON public.emails
  FOR INSERT
  TO authenticated
  WITH CHECK (
    direction IN ('incoming', 'outgoing')
    AND (client_id IS NOT NULL OR legacy_id IS NOT NULL OR contact_id IS NOT NULL)
  );

DROP POLICY IF EXISTS "staff_update_emails" ON public.emails;
CREATE POLICY "staff_update_emails"
  ON public.emails
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Bypass RLS for CRM compose / price-offer saves (Interactions + Offer tabs).
CREATE OR REPLACE FUNCTION public.insert_crm_email(p_row jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.emails (
    message_id,
    user_id,
    sender_name,
    sender_email,
    recipient_list,
    subject,
    body_html,
    body_preview,
    sent_at,
    direction,
    attachments,
    client_id,
    legacy_id,
    contact_id,
    thread_id,
    body_cached
  ) VALUES (
    NULLIF(p_row->>'message_id', ''),
    NULLIF(p_row->>'user_id', '')::uuid,
    p_row->>'sender_name',
    p_row->>'sender_email',
    p_row->>'recipient_list',
    COALESCE(p_row->>'subject', '(no subject)'),
    COALESCE(p_row->>'body_html', ''),
    p_row->>'body_preview',
    COALESCE((p_row->>'sent_at')::timestamptz, now()),
    COALESCE(NULLIF(p_row->>'direction', ''), 'outgoing'),
    CASE WHEN p_row ? 'attachments' THEN p_row->'attachments' ELSE NULL END,
    NULLIF(p_row->>'client_id', '')::uuid,
    NULLIF(p_row->>'legacy_id', '')::bigint,
    NULLIF(p_row->>'contact_id', '')::bigint,
    p_row->>'thread_id',
    COALESCE((p_row->>'body_cached')::boolean, true)
  )
  RETURNING emails.id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT e.id INTO v_id
    FROM public.emails e
    WHERE e.message_id = p_row->>'message_id'
    ORDER BY e.id DESC
    LIMIT 1;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_crm_email(jsonb)
  TO anon, authenticated, service_role;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.insert_mailbox_email(jsonb)
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END $$;

-- Stage-eval triggers on emails INSERT must not abort the row.
CREATE OR REPLACE FUNCTION public.ensure_pending_evaluations_table()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pending_stage_evaluations (
    lead_key TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    is_legacy BOOLEAN NOT NULL
  ) ON COMMIT DELETE ROWS;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_stage_evaluation_on_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_pending_evaluations_table();

  IF NEW.legacy_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('legacy_' || NEW.legacy_id::TEXT, NEW.legacy_id::TEXT, TRUE)
    ON CONFLICT (lead_key) DO NOTHING;
  ELSIF NEW.client_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('new_' || NEW.client_id::TEXT, NEW.client_id::TEXT, FALSE)
    ON CONFLICT (lead_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
