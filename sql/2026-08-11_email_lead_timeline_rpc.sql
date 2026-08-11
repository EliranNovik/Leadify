-- InteractionsTab / email modal lead emails — SECURITY DEFINER (row_security off).
-- Separate indexed branches so planner hits client_id / contact_id indexes.
-- Safe to re-run in SQL editor.

CREATE OR REPLACE FUNCTION public.email_lead_timeline(
  p_client_id uuid DEFAULT NULL,
  p_legacy_id bigint DEFAULT NULL,
  p_contact_ids bigint[] DEFAULT NULL,
  p_sender_emails text[] DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_lookback_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_since timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_lookback_days, 365), 1), 730));
  v_senders text[];
  v_has_scope boolean;
BEGIN
  IF p_sender_emails IS NOT NULL AND cardinality(p_sender_emails) > 0 THEN
    SELECT array_agg(DISTINCT lower(btrim(x)))
      INTO v_senders
    FROM unnest(p_sender_emails) AS x
    WHERE btrim(COALESCE(x, '')) <> '';
  END IF;

  v_has_scope :=
    p_client_id IS NOT NULL
    OR p_legacy_id IS NOT NULL
    OR (p_contact_ids IS NOT NULL AND cardinality(p_contact_ids) > 0);

  IF v_has_scope THEN
    RETURN COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sent_at DESC)
      FROM (
        SELECT *
        FROM (
          SELECT DISTINCT ON (u.id)
            u.id, u.message_id, u.subject, u.sent_at, u.direction,
            u.sender_email, u.recipient_list, u.body_preview, u.attachments,
            u.contact_id, u.client_id, u.legacy_id, u.sender_name
          FROM (
            (
              SELECT
                e.id, e.message_id, e.subject, e.sent_at, e.direction,
                e.sender_email, e.recipient_list, e.body_preview, e.attachments,
                e.contact_id, e.client_id, e.legacy_id, e.sender_name
              FROM public.emails e
              WHERE p_client_id IS NOT NULL
                AND e.client_id = p_client_id
              ORDER BY e.sent_at DESC
              LIMIT v_limit
            )
            UNION ALL
            (
              SELECT
                e.id, e.message_id, e.subject, e.sent_at, e.direction,
                e.sender_email, e.recipient_list, e.body_preview, e.attachments,
                e.contact_id, e.client_id, e.legacy_id, e.sender_name
              FROM public.emails e
              WHERE p_legacy_id IS NOT NULL
                AND e.legacy_id = p_legacy_id
              ORDER BY e.sent_at DESC
              LIMIT v_limit
            )
            UNION ALL
            (
              SELECT
                e.id, e.message_id, e.subject, e.sent_at, e.direction,
                e.sender_email, e.recipient_list, e.body_preview, e.attachments,
                e.contact_id, e.client_id, e.legacy_id, e.sender_name
              FROM public.emails e
              WHERE p_contact_ids IS NOT NULL
                AND cardinality(p_contact_ids) > 0
                AND e.contact_id = ANY (p_contact_ids)
              ORDER BY e.sent_at DESC
              LIMIT v_limit
            )
          ) u
          ORDER BY u.id, u.sent_at DESC
        ) d
        ORDER BY d.sent_at DESC
        LIMIT v_limit
      ) r
    ), '[]'::jsonb);
  END IF;

  IF v_senders IS NULL OR cardinality(v_senders) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sent_at DESC)
    FROM (
      SELECT
        e.id, e.message_id, e.subject, e.sent_at, e.direction,
        e.sender_email, e.recipient_list, e.body_preview, e.attachments,
        e.contact_id, e.client_id, e.legacy_id, e.sender_name
      FROM public.emails e
      WHERE e.sender_email = ANY (v_senders)
        AND e.sent_at >= v_since
      ORDER BY e.sent_at DESC
      LIMIT v_limit
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_lead_timeline(uuid, bigint, bigint[], text[], integer, integer)
  TO anon, authenticated, service_role;
