-- Fast WhatsApp sidebar RPC.
-- All Contacts: latest 8k messages by sent_at, then one row per conversation.
-- My Contacts: summarize messages for the lead/contact IDs the app already resolved
-- (no full-table lead scan, no column::text seq scans).
--
-- Run the entire file in the Supabase SQL editor, then reload the app.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_at_desc
  ON public.whatsapp_messages (sent_at DESC);

DROP FUNCTION IF EXISTS public.whatsapp_conversation_summary(bigint, text);
DROP FUNCTION IF EXISTS public.whatsapp_conversation_summary(bigint, text, uuid[], bigint[], bigint[]);
DROP FUNCTION IF EXISTS public.whatsapp_conversation_summary(bigint, text, text[], bigint[], bigint[]);

CREATE OR REPLACE FUNCTION public.whatsapp_conversation_summary(
  p_employee_id bigint DEFAULT NULL,
  p_employee_name text DEFAULT NULL,
  p_new_lead_ids uuid[] DEFAULT NULL,
  p_legacy_ids bigint[] DEFAULT NULL,
  p_contact_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  entity_type text,
  entity_id text,
  legacy_id bigint,
  last_sent_at timestamptz,
  unread_count bigint,
  sort_rank bigint,
  last_message_preview text,
  last_message_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  skip_vis boolean;
  has_ids boolean;
BEGIN
  has_ids :=
    COALESCE(cardinality(p_new_lead_ids), 0)
    + COALESCE(cardinality(p_legacy_ids), 0)
    + COALESCE(cardinality(p_contact_ids), 0) > 0;
  skip_vis := (NOT has_ids)
    AND p_employee_id IS NULL
    AND (p_employee_name IS NULL OR btrim(p_employee_name) = '');

  IF skip_vis THEN
    RETURN QUERY
    WITH recent AS MATERIALIZED (
      SELECT
        wm.lead_id,
        wm.contact_id,
        wm.legacy_id,
        wm.sent_at,
        wm.direction,
        wm.is_read,
        wm.message,
        wm.message_type,
        wm.caption,
        wm.voice_note,
        wm.media_filename
      FROM public.whatsapp_messages wm
      ORDER BY wm.sent_at DESC NULLS LAST
      LIMIT 8000
    ),
    lead_latest AS (
      SELECT DISTINCT ON (r.lead_id)
        'lead'::text AS entity_type,
        r.lead_id::text AS entity_id,
        NULL::bigint AS legacy_id,
        r.sent_at AS last_sent_at,
        r.direction AS last_message_direction,
        public.whatsapp_message_preview_text(
          r.message, r.message_type, r.caption, r.voice_note, r.media_filename
        ) AS last_message_preview
      FROM recent r
      WHERE r.lead_id IS NOT NULL AND r.contact_id IS NULL
      ORDER BY r.lead_id, r.sent_at DESC
    ),
    lead_unread AS (
      SELECT r.lead_id, COUNT(*)::bigint AS unread_count
      FROM recent r
      WHERE r.lead_id IS NOT NULL
        AND r.contact_id IS NULL
        AND r.direction = 'in'
        AND COALESCE(r.is_read, false) = false
      GROUP BY r.lead_id
    ),
    contact_latest AS (
      SELECT DISTINCT ON (r.contact_id)
        'contact'::text AS entity_type,
        r.contact_id::text AS entity_id,
        r.legacy_id,
        r.sent_at AS last_sent_at,
        r.direction AS last_message_direction,
        public.whatsapp_message_preview_text(
          r.message, r.message_type, r.caption, r.voice_note, r.media_filename
        ) AS last_message_preview
      FROM recent r
      WHERE r.contact_id IS NOT NULL
      ORDER BY r.contact_id, r.sent_at DESC
    ),
    contact_unread AS (
      SELECT r.contact_id, COUNT(*)::bigint AS unread_count
      FROM recent r
      WHERE r.contact_id IS NOT NULL
        AND r.direction = 'in'
        AND COALESCE(r.is_read, false) = false
      GROUP BY r.contact_id
    ),
    legacy_latest AS (
      SELECT DISTINCT ON (r.legacy_id)
        'legacy'::text AS entity_type,
        r.legacy_id::text AS entity_id,
        r.legacy_id,
        r.sent_at AS last_sent_at,
        r.direction AS last_message_direction,
        public.whatsapp_message_preview_text(
          r.message, r.message_type, r.caption, r.voice_note, r.media_filename
        ) AS last_message_preview
      FROM recent r
      WHERE r.legacy_id IS NOT NULL AND r.lead_id IS NULL AND r.contact_id IS NULL
      ORDER BY r.legacy_id, r.sent_at DESC
    ),
    legacy_unread AS (
      SELECT r.legacy_id, COUNT(*)::bigint AS unread_count
      FROM recent r
      WHERE r.legacy_id IS NOT NULL
        AND r.lead_id IS NULL
        AND r.contact_id IS NULL
        AND r.direction = 'in'
        AND COALESCE(r.is_read, false) = false
      GROUP BY r.legacy_id
    ),
    combined AS (
      SELECT ll.entity_type, ll.entity_id, ll.legacy_id, ll.last_sent_at,
             COALESCE(lu.unread_count, 0)::bigint AS unread_count,
             ll.last_message_preview, ll.last_message_direction
      FROM lead_latest ll
      LEFT JOIN lead_unread lu ON lu.lead_id::text = ll.entity_id
      UNION ALL
      SELECT cl.entity_type, cl.entity_id, cl.legacy_id, cl.last_sent_at,
             COALESCE(cu.unread_count, 0)::bigint,
             cl.last_message_preview, cl.last_message_direction
      FROM contact_latest cl
      LEFT JOIN contact_unread cu ON cu.contact_id::text = cl.entity_id
      UNION ALL
      SELECT lg.entity_type, lg.entity_id, lg.legacy_id, lg.last_sent_at,
             COALESCE(lgu.unread_count, 0)::bigint,
             lg.last_message_preview, lg.last_message_direction
      FROM legacy_latest lg
      LEFT JOIN legacy_unread lgu ON lgu.legacy_id = lg.legacy_id
    )
    SELECT
      c.entity_type,
      c.entity_id,
      c.legacy_id,
      c.last_sent_at,
      c.unread_count,
      ROW_NUMBER() OVER (ORDER BY c.last_sent_at DESC NULLS LAST, c.entity_type, c.entity_id)::bigint,
      c.last_message_preview,
      c.last_message_direction
    FROM combined c
    LIMIT 2500;
    RETURN;
  END IF;

  -- My Contacts: only messages for the IDs the client already resolved by role.
  RETURN QUERY
  WITH scoped AS MATERIALIZED (
    SELECT
      wm.lead_id,
      wm.contact_id,
      wm.legacy_id,
      wm.sent_at,
      wm.direction,
      wm.is_read,
      wm.message,
      wm.message_type,
      wm.caption,
      wm.voice_note,
      wm.media_filename
    FROM public.whatsapp_messages wm
    WHERE COALESCE(cardinality(p_new_lead_ids), 0) > 0
      AND wm.lead_id = ANY (p_new_lead_ids)
      AND wm.contact_id IS NULL
    UNION ALL
    SELECT
      wm.lead_id,
      wm.contact_id,
      wm.legacy_id,
      wm.sent_at,
      wm.direction,
      wm.is_read,
      wm.message,
      wm.message_type,
      wm.caption,
      wm.voice_note,
      wm.media_filename
    FROM public.whatsapp_messages wm
    WHERE COALESCE(cardinality(p_contact_ids), 0) > 0
      AND wm.contact_id = ANY (p_contact_ids)
    UNION ALL
    SELECT
      wm.lead_id,
      wm.contact_id,
      wm.legacy_id,
      wm.sent_at,
      wm.direction,
      wm.is_read,
      wm.message,
      wm.message_type,
      wm.caption,
      wm.voice_note,
      wm.media_filename
    FROM public.whatsapp_messages wm
    WHERE COALESCE(cardinality(p_legacy_ids), 0) > 0
      AND wm.legacy_id = ANY (p_legacy_ids)
      AND wm.lead_id IS NULL
      AND wm.contact_id IS NULL
  ),
  lead_latest AS (
    SELECT DISTINCT ON (r.lead_id)
      'lead'::text AS entity_type,
      r.lead_id::text AS entity_id,
      NULL::bigint AS legacy_id,
      r.sent_at AS last_sent_at,
      r.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        r.message, r.message_type, r.caption, r.voice_note, r.media_filename
      ) AS last_message_preview
    FROM scoped r
    WHERE r.lead_id IS NOT NULL AND r.contact_id IS NULL
    ORDER BY r.lead_id, r.sent_at DESC
  ),
  lead_unread AS (
    SELECT r.lead_id, COUNT(*)::bigint AS unread_count
    FROM scoped r
    WHERE r.lead_id IS NOT NULL
      AND r.contact_id IS NULL
      AND r.direction = 'in'
      AND COALESCE(r.is_read, false) = false
    GROUP BY r.lead_id
  ),
  contact_latest AS (
    SELECT DISTINCT ON (r.contact_id)
      'contact'::text AS entity_type,
      r.contact_id::text AS entity_id,
      r.legacy_id,
      r.sent_at AS last_sent_at,
      r.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        r.message, r.message_type, r.caption, r.voice_note, r.media_filename
      ) AS last_message_preview
    FROM scoped r
    WHERE r.contact_id IS NOT NULL
    ORDER BY r.contact_id, r.sent_at DESC
  ),
  contact_unread AS (
    SELECT r.contact_id, COUNT(*)::bigint AS unread_count
    FROM scoped r
    WHERE r.contact_id IS NOT NULL
      AND r.direction = 'in'
      AND COALESCE(r.is_read, false) = false
    GROUP BY r.contact_id
  ),
  legacy_latest AS (
    SELECT DISTINCT ON (r.legacy_id)
      'legacy'::text AS entity_type,
      r.legacy_id::text AS entity_id,
      r.legacy_id,
      r.sent_at AS last_sent_at,
      r.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        r.message, r.message_type, r.caption, r.voice_note, r.media_filename
      ) AS last_message_preview
    FROM scoped r
    WHERE r.legacy_id IS NOT NULL AND r.lead_id IS NULL AND r.contact_id IS NULL
    ORDER BY r.legacy_id, r.sent_at DESC
  ),
  legacy_unread AS (
    SELECT r.legacy_id, COUNT(*)::bigint AS unread_count
    FROM scoped r
    WHERE r.legacy_id IS NOT NULL
      AND r.lead_id IS NULL
      AND r.contact_id IS NULL
      AND r.direction = 'in'
      AND COALESCE(r.is_read, false) = false
    GROUP BY r.legacy_id
  ),
  combined AS (
    SELECT ll.entity_type, ll.entity_id, ll.legacy_id, ll.last_sent_at,
           COALESCE(lu.unread_count, 0)::bigint AS unread_count,
           ll.last_message_preview, ll.last_message_direction
    FROM lead_latest ll
    LEFT JOIN lead_unread lu ON lu.lead_id::text = ll.entity_id
    UNION ALL
    SELECT cl.entity_type, cl.entity_id, cl.legacy_id, cl.last_sent_at,
           COALESCE(cu.unread_count, 0)::bigint,
           cl.last_message_preview, cl.last_message_direction
    FROM contact_latest cl
    LEFT JOIN contact_unread cu ON cu.contact_id::text = cl.entity_id
    UNION ALL
    SELECT lg.entity_type, lg.entity_id, lg.legacy_id, lg.last_sent_at,
           COALESCE(lgu.unread_count, 0)::bigint,
           lg.last_message_preview, lg.last_message_direction
    FROM legacy_latest lg
    LEFT JOIN legacy_unread lgu ON lgu.legacy_id = lg.legacy_id
  )
  SELECT
    c.entity_type,
    c.entity_id,
    c.legacy_id,
    c.last_sent_at,
    c.unread_count,
    ROW_NUMBER() OVER (ORDER BY c.last_sent_at DESC NULLS LAST, c.entity_type, c.entity_id)::bigint,
    c.last_message_preview,
    c.last_message_direction
  FROM combined c
  LIMIT 2500;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_summary(bigint, text, uuid[], bigint[], bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_summary(bigint, text, uuid[], bigint[], bigint[]) TO service_role;

NOTIFY pgrst, 'reload schema';
