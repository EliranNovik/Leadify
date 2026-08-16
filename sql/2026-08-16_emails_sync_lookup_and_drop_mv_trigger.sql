-- Fast case-insensitive address lookup for mailbox sync (uses lower(email) indexes).
-- Stop refreshing recent_interactions_summary on every emails INSERT/UPDATE
-- (that scan times out on ~5M rows and blocks Graph sync: 57014).
-- Insert/update mailbox rows without firing those triggers.

CREATE OR REPLACE FUNCTION public.sync_lookup_addresses(p_emails text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '8s'
AS $$
  WITH addrs AS (
    SELECT DISTINCT lower(btrim(x)) AS email
    FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) AS x
    WHERE btrim(COALESCE(x, '')) <> ''
      AND position('@' in btrim(x)) > 0
  )
  SELECT jsonb_build_object(
    'leads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'email', l.email))
      FROM public.leads l
      INNER JOIN addrs a ON a.email = lower(btrim(l.email))
    ), '[]'::jsonb),
    'legacy', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ll.id, 'email', ll.email))
      FROM public.leads_lead ll
      INNER JOIN addrs a ON a.email = lower(btrim(ll.email))
    ), '[]'::jsonb),
    'contacts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'email', c.email,
        'newlead_id', c.newlead_id
      ))
      FROM public.leads_contact c
      INNER JOIN addrs a ON a.email = lower(btrim(c.email))
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.sync_lookup_addresses(text[])
  TO anon, authenticated, service_role;

-- Index lookup for Graph message_id (avoids PostgREST .in() seq scans).
CREATE OR REPLACE FUNCTION public.email_row_for_message(p_message_id text)
RETURNS TABLE (
  id bigint,
  message_id text,
  contact_id bigint,
  client_id uuid,
  legacy_id bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '15s'
AS $$
  SELECT e.id, e.message_id, e.contact_id, e.client_id, e.legacy_id
  FROM public.emails e
  WHERE e.message_id = p_message_id
  ORDER BY e.id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.email_row_for_message(text)
  TO anon, authenticated, service_role;

-- Insert one mailbox row without user triggers (MV refresh + stage eval).
CREATE OR REPLACE FUNCTION public.insert_mailbox_email(p_row jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '60s'
AS $$
DECLARE
  v_id bigint;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

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
    NULLIF(p_row->>'direction', ''),
    CASE WHEN p_row ? 'attachments' THEN p_row->'attachments' ELSE NULL END,
    NULLIF(p_row->>'client_id', '')::uuid,
    NULLIF(p_row->>'legacy_id', '')::bigint,
    NULLIF(p_row->>'contact_id', '')::bigint,
    p_row->>'thread_id',
    COALESCE((p_row->>'body_cached')::boolean, false)
  )
  RETURNING emails.id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT e.id INTO v_id
    FROM public.emails e
    WHERE e.message_id = p_row->>'message_id'
    ORDER BY e.id
    LIMIT 1;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_mailbox_email(jsonb)
  TO anon, authenticated, service_role;

-- Patch body/attachments by primary key without user triggers.
CREATE OR REPLACE FUNCTION public.update_mailbox_email_body(
  p_id bigint,
  p_body_html text DEFAULT NULL,
  p_body_preview text DEFAULT NULL,
  p_body_cached boolean DEFAULT NULL,
  p_attachments jsonb DEFAULT NULL,
  p_has_attachments boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '30s'
AS $$
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  UPDATE public.emails
  SET
    body_html = COALESCE(p_body_html, body_html),
    body_preview = COALESCE(p_body_preview, body_preview),
    body_cached = COALESCE(p_body_cached, body_cached),
    attachments = CASE WHEN p_has_attachments THEN p_attachments ELSE attachments END
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_mailbox_email_body(bigint, text, text, boolean, jsonb, boolean)
  TO anon, authenticated, service_role;

-- Do NOT DROP TRIGGER here: that takes AccessExclusiveLock on public.emails and
-- deadlocks with live mailbox sync (INSERT + REFRESH MATERIALIZED VIEW).
-- Replace the shared trigger function with a no-op instead (no table lock).
CREATE OR REPLACE FUNCTION public.trigger_refresh_recent_interactions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
