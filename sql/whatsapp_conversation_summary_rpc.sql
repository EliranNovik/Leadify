-- WhatsApp sidebar: aggregated + DB-sorted conversations (run entire file in Supabase SQL editor).
-- Fixes 404 on rpc('whatsapp_conversation_summary') and removes client-side full-table scans.

-- ---------------------------------------------------------------------------
-- Indexes (partial, aligned with aggregation filters)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_main_sent_at
  ON public.whatsapp_messages (lead_id, sent_at DESC)
  WHERE lead_id IS NOT NULL AND contact_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_main_unread
  ON public.whatsapp_messages (lead_id)
  WHERE lead_id IS NOT NULL
    AND contact_id IS NULL
    AND direction = 'in'
    AND COALESCE(is_read, false) = false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_sent_at
  ON public.whatsapp_messages (contact_id, sent_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_unread
  ON public.whatsapp_messages (contact_id)
  WHERE contact_id IS NOT NULL
    AND direction = 'in'
    AND COALESCE(is_read, false) = false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_only_sent_at
  ON public.whatsapp_messages (legacy_id, sent_at DESC)
  WHERE legacy_id IS NOT NULL
    AND lead_id IS NULL
    AND contact_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_only_unread
  ON public.whatsapp_messages (legacy_id)
  WHERE legacy_id IS NOT NULL
    AND lead_id IS NULL
    AND contact_id IS NULL
    AND direction = 'in'
    AND COALESCE(is_read, false) = false;

-- Chat thread pagination (newest page + load older via sent_at)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_sent_at_paged
  ON public.whatsapp_messages (lead_id, sent_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_sent_at_paged
  ON public.whatsapp_messages (contact_id, sent_at DESC)
  WHERE contact_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Employee visibility (My Contacts) — mirrors app role checks (numeric id + name)
-- ---------------------------------------------------------------------------
-- Safe compare when column may be bigint or text (legacy leads_lead).
CREATE OR REPLACE FUNCTION public.whatsapp_employee_id_matches(
  col_value text,
  p_employee_id bigint
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_employee_id IS NOT NULL
    AND col_value IS NOT NULL
    AND btrim(col_value) <> ''
    AND btrim(col_value) ~ '^\d+$'
    AND btrim(col_value)::bigint = p_employee_id;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_text_field_matches_employee(
  field_value text,
  p_employee_id bigint,
  p_employee_name text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    (p_employee_id IS NOT NULL AND field_value ~ '^\d+$' AND field_value::bigint = p_employee_id)
    OR (
      p_employee_name IS NOT NULL
      AND btrim(p_employee_name) <> ''
      AND field_value IS NOT NULL
      AND lower(btrim(field_value)) = lower(btrim(p_employee_name))
    );
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_new_lead_visible_to_employee(
  p_new_lead public.leads,
  p_employee_id bigint,
  p_employee_name text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    (p_employee_id IS NULL AND (p_employee_name IS NULL OR btrim(p_employee_name) = ''))
    OR (
      p_employee_id IS NOT NULL
      AND (
        public.whatsapp_employee_id_matches((p_new_lead).case_handler_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).expert_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).meeting_lawyer_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).meeting_manager_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).retainer_handler_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).meeting_collection_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_new_lead).marketing_officer_id::text, p_employee_id)
      )
    )
    OR public.whatsapp_text_field_matches_employee((p_new_lead).closer::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).scheduler::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).handler::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).helper::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).lawyer::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).manager::text, p_employee_id, p_employee_name)
    OR public.whatsapp_text_field_matches_employee((p_new_lead).expert::text, p_employee_id, p_employee_name);
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_legacy_lead_visible_to_employee(
  p_legacy_lead public.leads_lead,
  p_employee_id bigint,
  p_employee_name text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    (p_employee_id IS NULL AND (p_employee_name IS NULL OR btrim(p_employee_name) = ''))
    OR (
      p_employee_id IS NOT NULL
      AND (
        public.whatsapp_employee_id_matches((p_legacy_lead).closer_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).meeting_scheduler_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).meeting_manager_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).meeting_lawyer_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).case_handler_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).expert_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).retainer_handler_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).meeting_collection_id::text, p_employee_id)
        OR public.whatsapp_employee_id_matches((p_legacy_lead).marketing_officer_id::text, p_employee_id)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_message_visible_to_employee(
  p_msg public.whatsapp_messages,
  p_employee_id bigint,
  p_employee_name text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    (p_employee_id IS NULL AND (p_employee_name IS NULL OR btrim(p_employee_name) = ''))
    OR (
      (p_msg).lead_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.leads nl
        WHERE nl.id = (p_msg).lead_id
          AND public.whatsapp_new_lead_visible_to_employee(nl, p_employee_id, p_employee_name)
      )
    )
    OR (
      (p_msg).legacy_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.leads_lead leg
        WHERE leg.id = (p_msg).legacy_id
          AND public.whatsapp_legacy_lead_visible_to_employee(leg, p_employee_id, p_employee_name)
      )
    )
    OR (
      (p_msg).contact_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.lead_leadcontact llc
        LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
        LEFT JOIN public.leads_lead leg ON leg.id = llc.lead_id
        WHERE llc.contact_id = (p_msg).contact_id
          AND (
            (nl.id IS NOT NULL AND public.whatsapp_new_lead_visible_to_employee(nl, p_employee_id, p_employee_name))
            OR (leg.id IS NOT NULL AND public.whatsapp_legacy_lead_visible_to_employee(leg, p_employee_id, p_employee_name))
          )
      )
    );
$$;

-- Sidebar preview text for the latest message in a conversation.
CREATE OR REPLACE FUNCTION public.whatsapp_message_preview_text(
  p_message text,
  p_message_type text,
  p_caption text,
  p_voice_note boolean,
  p_media_filename text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEFT(
    CASE lower(COALESCE(p_message_type, 'text'))
      WHEN 'image' THEN COALESCE(NULLIF(btrim(p_caption), ''), '📷 Photo')
      WHEN 'video' THEN COALESCE(NULLIF(btrim(p_caption), ''), '🎥 Video')
      WHEN 'audio' THEN '🎤 Voice message'
      WHEN 'text' THEN CASE
        WHEN COALESCE(p_voice_note, false) THEN '🎤 Voice message'
        ELSE COALESCE(NULLIF(btrim(p_message), ''), 'Message')
      END
      WHEN 'document' THEN COALESCE(
        NULLIF(btrim(p_caption), ''),
        NULLIF(btrim(p_media_filename), ''),
        '📎 Document'
      )
      WHEN 'location' THEN '📍 Location'
      WHEN 'contact' THEN '👤 Contact'
      WHEN 'button_response' THEN COALESCE(NULLIF(btrim(p_message), ''), 'Response')
      WHEN 'list_response' THEN COALESCE(NULLIF(btrim(p_message), ''), 'Response')
      ELSE COALESCE(NULLIF(btrim(p_message), ''), 'Message')
    END,
    120
  );
$$;

-- ---------------------------------------------------------------------------
-- Summary RPC: aggregate + ORDER BY in Postgres (sidebar sort order)
-- Optional employee args = My Contacts filter (NULL = All Contacts)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.whatsapp_conversation_summary(bigint, text);
DROP FUNCTION IF EXISTS public.whatsapp_conversation_summary();

CREATE OR REPLACE FUNCTION public.whatsapp_conversation_summary(
  p_employee_id bigint DEFAULT NULL,
  p_employee_name text DEFAULT NULL
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered_messages AS (
    SELECT wm.*
    FROM public.whatsapp_messages wm
    WHERE public.whatsapp_message_visible_to_employee(wm, p_employee_id, p_employee_name)
  ),
  lead_latest AS (
    SELECT DISTINCT ON (fm.lead_id)
      'lead'::text AS entity_type,
      fm.lead_id::text AS entity_id,
      NULL::bigint AS legacy_id,
      fm.sent_at AS last_sent_at,
      fm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        fm.message, fm.message_type, fm.caption, fm.voice_note, fm.media_filename
      ) AS last_message_preview
    FROM filtered_messages fm
    WHERE fm.lead_id IS NOT NULL
      AND fm.contact_id IS NULL
    ORDER BY fm.lead_id, fm.sent_at DESC
  ),
  lead_unread AS (
    SELECT
      fm.lead_id,
      COUNT(*) FILTER (
        WHERE fm.direction = 'in' AND COALESCE(fm.is_read, false) = false
      )::bigint AS unread_count
    FROM filtered_messages fm
    WHERE fm.lead_id IS NOT NULL
      AND fm.contact_id IS NULL
    GROUP BY fm.lead_id
  ),
  contact_latest AS (
    SELECT DISTINCT ON (fm.contact_id)
      'contact'::text AS entity_type,
      fm.contact_id::text AS entity_id,
      fm.legacy_id,
      fm.sent_at AS last_sent_at,
      fm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        fm.message, fm.message_type, fm.caption, fm.voice_note, fm.media_filename
      ) AS last_message_preview
    FROM filtered_messages fm
    WHERE fm.contact_id IS NOT NULL
    ORDER BY fm.contact_id, fm.sent_at DESC
  ),
  contact_unread AS (
    SELECT
      fm.contact_id,
      COUNT(*) FILTER (
        WHERE fm.direction = 'in' AND COALESCE(fm.is_read, false) = false
      )::bigint AS unread_count
    FROM filtered_messages fm
    WHERE fm.contact_id IS NOT NULL
    GROUP BY fm.contact_id
  ),
  legacy_latest AS (
    SELECT DISTINCT ON (fm.legacy_id)
      'legacy'::text AS entity_type,
      fm.legacy_id::text AS entity_id,
      fm.legacy_id,
      fm.sent_at AS last_sent_at,
      fm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        fm.message, fm.message_type, fm.caption, fm.voice_note, fm.media_filename
      ) AS last_message_preview
    FROM filtered_messages fm
    WHERE fm.legacy_id IS NOT NULL
      AND fm.lead_id IS NULL
      AND fm.contact_id IS NULL
    ORDER BY fm.legacy_id, fm.sent_at DESC
  ),
  legacy_unread AS (
    SELECT
      fm.legacy_id,
      COUNT(*) FILTER (
        WHERE fm.direction = 'in' AND COALESCE(fm.is_read, false) = false
      )::bigint AS unread_count
    FROM filtered_messages fm
    WHERE fm.legacy_id IS NOT NULL
      AND fm.lead_id IS NULL
      AND fm.contact_id IS NULL
    GROUP BY fm.legacy_id
  ),
  combined AS (
    SELECT
      ll.entity_type,
      ll.entity_id,
      ll.legacy_id,
      ll.last_sent_at,
      COALESCE(lu.unread_count, 0)::bigint AS unread_count,
      ll.last_message_preview,
      ll.last_message_direction
    FROM lead_latest ll
    LEFT JOIN lead_unread lu ON lu.lead_id = ll.entity_id::uuid

    UNION ALL

    SELECT
      cl.entity_type,
      cl.entity_id,
      cl.legacy_id,
      cl.last_sent_at,
      COALESCE(cu.unread_count, 0)::bigint,
      cl.last_message_preview,
      cl.last_message_direction
    FROM contact_latest cl
    LEFT JOIN contact_unread cu ON cu.contact_id = cl.entity_id::bigint

    UNION ALL

    SELECT
      lg.entity_type,
      lg.entity_id,
      lg.legacy_id,
      lg.last_sent_at,
      COALESCE(lgu.unread_count, 0)::bigint,
      lg.last_message_preview,
      lg.last_message_direction
    FROM legacy_latest lg
    LEFT JOIN legacy_unread lgu ON lgu.legacy_id = lg.legacy_id
  )
  SELECT
    c.entity_type,
    c.entity_id,
    c.legacy_id,
    c.last_sent_at,
    c.unread_count,
    ROW_NUMBER() OVER (
      ORDER BY c.last_sent_at DESC NULLS LAST, c.entity_type, c.entity_id
    )::bigint AS sort_rank,
    c.last_message_preview,
    c.last_message_direction
  FROM combined c;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_summary(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_conversation_summary(bigint, text) TO service_role;

COMMENT ON FUNCTION public.whatsapp_conversation_summary(bigint, text) IS
  'WhatsApp sidebar: last_sent_at, unread_count, preview, sort_rank (recency). Pass employee for My Contacts.';

NOTIFY pgrst, 'reload schema';

ANALYZE public.whatsapp_messages;
