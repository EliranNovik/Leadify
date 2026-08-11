-- Office inbox conversation for one external sender (EmailThreadLeadPage).
-- CRITICAL: drive on sender_email equality so idx_emails_sender_email_sent_at is used.
-- Incoming + outgoing are separate RPCs so a heavy outbound scan cannot block inbound.
-- Outgoing: prefer linked FKs from that sender's incoming rows, then a bounded
-- outgoing sent_at scan (uses idx_emails_outgoing_sent_at when present).
-- Run via psql (session pooler). Safe to re-run.

SET statement_timeout TO '0';

DROP FUNCTION IF EXISTS public.email_office_thread_for_sender(text, integer, integer);
DROP FUNCTION IF EXISTS public.email_office_thread_incoming_for_sender(text, integer, integer);
DROP FUNCTION IF EXISTS public.email_office_thread_outgoing_to_sender(text, integer, integer);
DROP FUNCTION IF EXISTS public.email_office_mark_sender_read(text, integer);
DROP FUNCTION IF EXISTS public.email_office_connected_ids_for_sender(text, integer, integer);

CREATE FUNCTION public.email_office_thread_incoming_for_sender(
  p_sender_email text,
  p_days integer DEFAULT 180,
  p_limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '15s'
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_sender_email, ''));
  v_lower text := lower(v_raw);
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 180), 1), 365);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 400);
  v_since timestamptz := now() - make_interval(days => v_days);
BEGIN
  IF v_raw = '' OR position('@' in v_raw) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent_at ASC)
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
        e.attachments,
        e.client_id,
        e.legacy_id,
        e.contact_id
      FROM public.emails e
      WHERE e.direction = 'incoming'
        AND e.sent_at >= v_since
        AND (
          e.sender_email = v_lower
          OR (v_raw <> v_lower AND e.sender_email = v_raw)
        )
        AND e.sender_email IS NOT NULL
        AND btrim(e.sender_email) <> ''
      ORDER BY e.sent_at DESC
      LIMIT v_limit
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.email_office_thread_outgoing_to_sender(
  p_sender_email text,
  p_days integer DEFAULT 90,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '20s'
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_sender_email, ''));
  v_lower text := lower(v_raw);
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 1), 180);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 300);
  v_since timestamptz := now() - make_interval(days => v_days);
  -- Prefer a tighter scan now that idx_emails_outgoing_sent_at exists.
  v_scan integer := LEAST(GREATEST(v_limit * 6, 400), 1200);
  v_contact_ids bigint[];
  v_legacy_ids bigint[];
  v_client_ids uuid[];
BEGIN
  IF v_raw = '' OR position('@' in v_raw) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Collect link keys from this sender's recent incoming (indexed sender_email path).
  SELECT
    array_agg(DISTINCT x.contact_id) FILTER (WHERE x.contact_id IS NOT NULL),
    array_agg(DISTINCT x.legacy_id) FILTER (WHERE x.legacy_id IS NOT NULL),
    array_agg(DISTINCT x.client_id) FILTER (WHERE x.client_id IS NOT NULL)
  INTO v_contact_ids, v_legacy_ids, v_client_ids
  FROM (
    SELECT e.contact_id, e.legacy_id, e.client_id
    FROM public.emails e
    WHERE e.direction = 'incoming'
      AND e.sent_at >= v_since
      AND (
        e.sender_email = v_lower
        OR (v_raw <> v_lower AND e.sender_email = v_raw)
      )
      AND e.sender_email IS NOT NULL
      AND btrim(e.sender_email) <> ''
      AND (e.client_id IS NOT NULL OR e.legacy_id IS NOT NULL OR e.contact_id IS NOT NULL)
    ORDER BY e.sent_at DESC
    LIMIT 80
  ) x;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent_at ASC)
    FROM (
      SELECT DISTINCT ON (m.id)
        m.id,
        m.message_id,
        m.sender_name,
        m.sender_email,
        m.recipient_list,
        m.subject,
        m.body_preview,
        m.sent_at,
        m.direction,
        m.attachments,
        m.client_id,
        m.legacy_id,
        m.contact_id
      FROM (
        (
          SELECT
            e.id, e.message_id, e.sender_name, e.sender_email, e.recipient_list,
            e.subject, e.body_preview, e.sent_at, e.direction, e.attachments,
            e.client_id, e.legacy_id, e.contact_id
          FROM public.emails e
          WHERE v_contact_ids IS NOT NULL
            AND cardinality(v_contact_ids) > 0
            AND e.direction = 'outgoing'
            AND e.sent_at >= v_since
            AND e.contact_id = ANY (v_contact_ids)
          ORDER BY e.sent_at DESC
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            e.id, e.message_id, e.sender_name, e.sender_email, e.recipient_list,
            e.subject, e.body_preview, e.sent_at, e.direction, e.attachments,
            e.client_id, e.legacy_id, e.contact_id
          FROM public.emails e
          WHERE v_legacy_ids IS NOT NULL
            AND cardinality(v_legacy_ids) > 0
            AND e.direction = 'outgoing'
            AND e.sent_at >= v_since
            AND e.legacy_id = ANY (v_legacy_ids)
          ORDER BY e.sent_at DESC
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            e.id, e.message_id, e.sender_name, e.sender_email, e.recipient_list,
            e.subject, e.body_preview, e.sent_at, e.direction, e.attachments,
            e.client_id, e.legacy_id, e.contact_id
          FROM public.emails e
          WHERE v_client_ids IS NOT NULL
            AND cardinality(v_client_ids) > 0
            AND e.direction = 'outgoing'
            AND e.sent_at >= v_since
            AND e.client_id = ANY (v_client_ids)
          ORDER BY e.sent_at DESC
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT *
          FROM (
            SELECT
              e.id, e.message_id, e.sender_name, e.sender_email, e.recipient_list,
              e.subject, e.body_preview, e.sent_at, e.direction, e.attachments,
              e.client_id, e.legacy_id, e.contact_id
            FROM public.emails e
            WHERE e.direction = 'outgoing'
              AND e.sent_at >= v_since
            ORDER BY e.sent_at DESC
            LIMIT v_scan
          ) scan
          WHERE position(v_lower in lower(COALESCE(scan.recipient_list, ''))) > 0
             OR (v_raw <> v_lower AND position(v_raw in COALESCE(scan.recipient_list, '')) > 0)
          ORDER BY scan.sent_at DESC
          LIMIT v_limit
        )
      ) m
      ORDER BY m.id, m.sent_at DESC
      LIMIT v_limit
    ) x
  ), '[]'::jsonb);
END;
$$;

-- Back-compat wrapper used by older clients: incoming only (fast).
CREATE FUNCTION public.email_office_thread_for_sender(
  p_sender_email text,
  p_days integer DEFAULT 180,
  p_limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.email_office_thread_incoming_for_sender(p_sender_email, p_days, p_limit);
$$;

CREATE FUNCTION public.email_office_mark_sender_read(
  p_sender_email text,
  p_days integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '15s'
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_sender_email, ''));
  v_lower text := lower(v_raw);
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 180), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_updated integer := 0;
BEGIN
  IF v_raw = '' OR position('@' in v_raw) = 0 THEN
    RETURN 0;
  END IF;

  WITH targets AS (
    SELECT e.id
    FROM public.emails e
    WHERE e.direction = 'incoming'
      AND e.sent_at >= v_since
      AND (
        e.sender_email = v_lower
        OR (v_raw <> v_lower AND e.sender_email = v_raw)
      )
      AND e.sender_email IS NOT NULL
      AND btrim(e.sender_email) <> ''
      AND COALESCE(e.is_read, false) = false
    ORDER BY e.sent_at DESC
    LIMIT 500
  ),
  updated AS (
    UPDATE public.emails e
    SET
      is_read = true,
      read_at = now()
    FROM targets t
    WHERE e.id = t.id
    RETURNING e.id
  )
  SELECT COUNT(*)::integer INTO v_updated FROM updated;

  RETURN COALESCE(v_updated, 0);
END;
$$;

CREATE FUNCTION public.email_office_connected_ids_for_sender(
  p_sender_email text,
  p_days integer DEFAULT 365,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '15s'
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_sender_email, ''));
  v_lower text := lower(v_raw);
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 365), 1), 365);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 300);
  v_since timestamptz := now() - make_interval(days => v_days);
BEGIN
  IF v_raw = '' OR position('@' in v_raw) = 0 THEN
    RETURN jsonb_build_object(
      'client_ids', '[]'::jsonb,
      'legacy_ids', '[]'::jsonb,
      'contact_ids', '[]'::jsonb
    );
  END IF;

  RETURN (
    WITH rows AS (
      SELECT e.client_id, e.legacy_id, e.contact_id
      FROM public.emails e
      WHERE e.sent_at >= v_since
        AND (
          e.sender_email = v_lower
          OR (v_raw <> v_lower AND e.sender_email = v_raw)
        )
        AND e.sender_email IS NOT NULL
        AND btrim(e.sender_email) <> ''
      ORDER BY e.sent_at DESC
      LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'client_ids', COALESCE(
        (SELECT jsonb_agg(DISTINCT r.client_id) FROM rows r WHERE r.client_id IS NOT NULL),
        '[]'::jsonb
      ),
      'legacy_ids', COALESCE(
        (SELECT jsonb_agg(DISTINCT r.legacy_id) FROM rows r WHERE r.legacy_id IS NOT NULL),
        '[]'::jsonb
      ),
      'contact_ids', COALESCE(
        (SELECT jsonb_agg(DISTINCT r.contact_id) FROM rows r WHERE r.contact_id IS NOT NULL),
        '[]'::jsonb
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_office_thread_incoming_for_sender(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.email_office_thread_outgoing_to_sender(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.email_office_thread_for_sender(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.email_office_mark_sender_read(text, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.email_office_connected_ids_for_sender(text, integer, integer) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
