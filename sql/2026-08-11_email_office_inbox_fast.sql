-- Fix email RPCs: sent_at-first (uses idx_emails_incoming_sent_at / unread index).
-- Do NOT put ILIKE in the driving WHERE — that still seq-scans on this table.
-- Run in SQL editor or psql.

SET statement_timeout TO '0';

DROP FUNCTION IF EXISTS public.header_unread_emails_for_badge(integer, integer);
DROP FUNCTION IF EXISTS public.header_office_inbox_unread_emails(integer, integer, integer);
DROP FUNCTION IF EXISTS public.email_office_inbox_recent(integer, integer);

-- Badge: match unread partial index predicate exactly
CREATE FUNCTION public.header_unread_emails_for_badge(
  p_days integer DEFAULT 2,
  p_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT e.id, e.client_id, e.legacy_id, e.sender_email
    FROM public.emails e
    WHERE e.sent_at >= (now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 2), 1), 7)))
      AND e.direction = 'incoming'
      AND COALESCE(e.is_read, false) = false
    ORDER BY e.sent_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200)
  ) x;
$$;

-- Office unread: recent unread first, THEN filter office@ (tiny in-memory filter)
CREATE FUNCTION public.header_office_inbox_unread_emails(
  p_days integer DEFAULT 2,
  p_limit integer DEFAULT 40,
  p_scan_limit integer DEFAULT 400
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT
      r.id,
      r.sender_name,
      r.sender_email,
      r.subject,
      r.body_preview,
      r.sent_at,
      r.recipient_list
    FROM (
      SELECT
        e.id,
        e.sender_name,
        e.sender_email,
        e.subject,
        e.body_preview,
        e.sent_at,
        e.recipient_list
      FROM public.emails e
      WHERE e.sent_at >= (now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 2), 1), 7)))
        AND e.direction = 'incoming'
        AND COALESCE(e.is_read, false) = false
      ORDER BY e.sent_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_scan_limit, 400), 1), 800)
    ) r
    WHERE position('office@lawoffice.org.il' in lower(COALESCE(r.recipient_list, ''))) > 0
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100)
  ) x;
$$;

-- Email leads page: recent incoming by time, THEN filter office@
CREATE FUNCTION public.email_office_inbox_recent(
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 400
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  FROM (
    SELECT
      r.id,
      r.message_id,
      r.sender_name,
      r.sender_email,
      r.recipient_list,
      r.subject,
      r.body_preview,
      r.sent_at,
      r.direction,
      r.is_read,
      r.client_id,
      r.legacy_id,
      r.contact_id
    FROM (
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
        e.is_read,
        e.client_id,
        e.legacy_id,
        e.contact_id
      FROM public.emails e
      WHERE e.sent_at >= (now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 90)))
        AND e.direction = 'incoming'
      ORDER BY e.sent_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 400) * 5, 1), 3000)
    ) r
    WHERE position('office@lawoffice.org.il' in lower(COALESCE(r.recipient_list, ''))) > 0
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 400), 1), 800)
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.header_unread_emails_for_badge(integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.header_office_inbox_unread_emails(integer, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.email_office_inbox_recent(integer, integer) TO authenticated, anon;

-- EmailThreadModal: distinct linked lead ids from recent mail (sent_at-first, no OR-null scan)
DROP FUNCTION IF EXISTS public.email_recent_linked_lead_ids(integer, integer);
CREATE FUNCTION public.email_recent_linked_lead_ids(
  p_days integer DEFAULT 90,
  p_scan_limit integer DEFAULT 2500
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH recent AS (
    SELECT e.client_id, e.legacy_id
    FROM public.emails e
    WHERE e.sent_at >= (now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 90), 1), 180)))
    ORDER BY e.sent_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_scan_limit, 2500), 1), 5000)
  )
  SELECT jsonb_build_object(
    'client_ids', COALESCE(
      (SELECT jsonb_agg(DISTINCT r.client_id) FROM recent r WHERE r.client_id IS NOT NULL),
      '[]'::jsonb
    ),
    'legacy_ids', COALESCE(
      (SELECT jsonb_agg(DISTINCT r.legacy_id) FROM recent r WHERE r.legacy_id IS NOT NULL),
      '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.email_recent_linked_lead_ids(integer, integer) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

-- Sanity (should return in well under 1s):
-- SELECT jsonb_array_length(public.header_unread_emails_for_badge(2, 20));
-- SELECT jsonb_array_length(public.email_office_inbox_recent(14, 50));
-- SELECT public.email_recent_linked_lead_ids(30, 1000);
