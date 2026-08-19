-- Stop 23503 emails_user_id_fkey on mailbox sync.
-- emails.user_id references auth.users(id); Graph sync was passing public.users.id.
-- Backend now sends user_id: null; this RPC ignores p_row.user_id so old deploys stop erroring too.
-- Safe to re-run.

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
    NULL,
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
