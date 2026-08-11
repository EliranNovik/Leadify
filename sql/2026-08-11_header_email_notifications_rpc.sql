-- =============================================================================
-- Header email RPCs ONLY — safe for Supabase SQL editor (re-run anytime)
-- =============================================================================
-- No DROP / No CREATE INDEX (those lock or time out the editor).
-- Office inbox: scan recent rows by sent_at FIRST, then filter office@
-- (works with BRIN until btree indexes from step 2 are built).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.header_unread_emails_for_badge(
  p_days integer DEFAULT 2,
  p_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'client_id', x.client_id,
        'legacy_id', x.legacy_id,
        'sender_email', x.sender_email
      )
    ),
    '[]'::jsonb
  )
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

CREATE OR REPLACE FUNCTION public.header_office_inbox_unread_emails(
  p_days integer DEFAULT 2,
  p_limit integer DEFAULT 40,
  p_scan_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'sender_name', x.sender_name,
        'sender_email', x.sender_email,
        'subject', x.subject,
        'body_preview', x.body_preview,
        'sent_at', x.sent_at,
        'recipient_list', x.recipient_list
      )
    ),
    '[]'::jsonb
  )
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
      -- Phase 1: time-bounded scan only (uses BRIN / sent_at); NO ilike here
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
      LIMIT LEAST(GREATEST(COALESCE(p_scan_limit, 250), 1), 500)
    ) r
    -- Phase 2: cheap filter on the small recent set
    WHERE lower(COALESCE(r.recipient_list, '')) LIKE '%office@lawoffice.org.il%'
    ORDER BY r.sent_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100)
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.header_unread_emails_for_badge(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.header_unread_emails_for_badge(integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.header_office_inbox_unread_emails(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.header_office_inbox_unread_emails(integer, integer, integer) TO anon;

NOTIFY pgrst, 'reload schema';
