-- Office inbox conversation for one external sender (EmailThreadLeadPage).
-- Drive on indexed sender_email / sent_at — never driving recipient_list ILIKE.
-- Run via psql (session pooler). Safe to re-run.

SET statement_timeout TO '0';

DROP FUNCTION IF EXISTS public.email_office_thread_for_sender(text, integer, integer);

CREATE FUNCTION public.email_office_thread_for_sender(
  p_sender_email text,
  p_days integer DEFAULT 365,
  p_limit integer DEFAULT 400
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_sender text := lower(btrim(COALESCE(p_sender_email, '')));
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 365), 1), 730);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 400), 1), 600);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_office text := 'office@lawoffice.org.il';
BEGIN
  IF v_sender = '' OR position('@' in v_sender) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    WITH incoming AS (
      SELECT
        e.id,
        e.message_id,
        e.sender_name,
        e.sender_email,
        e.recipient_list,
        e.subject,
        e.body_preview,
        e.sent_at,
        e.direction,
        e.attachments,
        e.client_id,
        e.legacy_id,
        e.contact_id
      FROM public.emails e
      WHERE e.direction = 'incoming'
        AND e.sent_at >= v_since
        AND lower(btrim(e.sender_email)) = v_sender
        AND position(v_office in lower(COALESCE(e.recipient_list, ''))) > 0
      ORDER BY e.sent_at ASC
      LIMIT v_limit
    ),
    -- Recent office outbound, then keep only those addressed to this sender.
    outgoing_scan AS (
      SELECT
        e.id,
        e.message_id,
        e.sender_name,
        e.sender_email,
        e.recipient_list,
        e.subject,
        e.body_preview,
        e.sent_at,
        e.direction,
        e.attachments,
        e.client_id,
        e.legacy_id,
        e.contact_id
      FROM public.emails e
      WHERE e.direction = 'outgoing'
        AND e.sent_at >= v_since
        AND lower(btrim(e.sender_email)) = v_office
      ORDER BY e.sent_at DESC
      LIMIT LEAST(v_limit * 8, 4000)
    ),
    outgoing AS (
      SELECT *
      FROM outgoing_scan o
      WHERE position(v_sender in lower(COALESCE(o.recipient_list, ''))) > 0
      ORDER BY o.sent_at ASC
      LIMIT v_limit
    )
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent_at ASC)
    FROM (
      SELECT * FROM incoming
      UNION ALL
      SELECT * FROM outgoing
    ) x
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_office_thread_for_sender(text, integer, integer) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

-- Sanity:
-- SELECT jsonb_array_length(public.email_office_thread_for_sender('someone@gmail.com', 365, 50));
