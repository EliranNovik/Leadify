-- Faster WhatsApp sidebar RPC: do not materialize every whatsapp_messages row.
-- Run in the Supabase SQL editor. Same return shape as whatsapp_conversation_summary.

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
  WITH params AS (
    SELECT (
      p_employee_id IS NULL
      AND (p_employee_name IS NULL OR btrim(p_employee_name) = '')
    ) AS skip_vis
  ),
  visible_new_lead_ids AS (
    SELECT l.id
    FROM public.leads l
    CROSS JOIN params p
    WHERE NOT p.skip_vis
      AND public.whatsapp_new_lead_visible_to_employee(l, p_employee_id, p_employee_name)
  ),
  visible_legacy_lead_ids AS (
    SELECT leg.id
    FROM public.leads_lead leg
    CROSS JOIN params p
    WHERE NOT p.skip_vis
      AND public.whatsapp_legacy_lead_visible_to_employee(leg, p_employee_id, p_employee_name)
  ),
  visible_contact_ids AS (
    SELECT DISTINCT llc.contact_id
    FROM public.lead_leadcontact llc
    CROSS JOIN params p
    LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
    LEFT JOIN public.leads_lead leg ON leg.id = llc.lead_id
    WHERE NOT p.skip_vis
      AND llc.contact_id IS NOT NULL
      AND (
        (nl.id IS NOT NULL AND public.whatsapp_new_lead_visible_to_employee(nl, p_employee_id, p_employee_name))
        OR (leg.id IS NOT NULL AND public.whatsapp_legacy_lead_visible_to_employee(leg, p_employee_id, p_employee_name))
      )
  ),
  lead_latest AS (
    SELECT DISTINCT ON (wm.lead_id)
      'lead'::text AS entity_type,
      wm.lead_id::text AS entity_id,
      NULL::bigint AS legacy_id,
      wm.sent_at AS last_sent_at,
      wm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        wm.message, wm.message_type, wm.caption, wm.voice_note, wm.media_filename
      ) AS last_message_preview
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.lead_id IS NOT NULL
      AND wm.contact_id IS NULL
      AND (p.skip_vis OR wm.lead_id IN (SELECT id FROM visible_new_lead_ids))
    ORDER BY wm.lead_id, wm.sent_at DESC
  ),
  lead_unread AS (
    SELECT
      wm.lead_id,
      COUNT(*)::bigint AS unread_count
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.lead_id IS NOT NULL
      AND wm.contact_id IS NULL
      AND wm.direction = 'in'
      AND COALESCE(wm.is_read, false) = false
      AND (p.skip_vis OR wm.lead_id IN (SELECT id FROM visible_new_lead_ids))
    GROUP BY wm.lead_id
  ),
  contact_latest AS (
    SELECT DISTINCT ON (wm.contact_id)
      'contact'::text AS entity_type,
      wm.contact_id::text AS entity_id,
      wm.legacy_id,
      wm.sent_at AS last_sent_at,
      wm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        wm.message, wm.message_type, wm.caption, wm.voice_note, wm.media_filename
      ) AS last_message_preview
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.contact_id IS NOT NULL
      AND (p.skip_vis OR wm.contact_id IN (SELECT contact_id FROM visible_contact_ids))
    ORDER BY wm.contact_id, wm.sent_at DESC
  ),
  contact_unread AS (
    SELECT
      wm.contact_id,
      COUNT(*)::bigint AS unread_count
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.contact_id IS NOT NULL
      AND wm.direction = 'in'
      AND COALESCE(wm.is_read, false) = false
      AND (p.skip_vis OR wm.contact_id IN (SELECT contact_id FROM visible_contact_ids))
    GROUP BY wm.contact_id
  ),
  legacy_latest AS (
    SELECT DISTINCT ON (wm.legacy_id)
      'legacy'::text AS entity_type,
      wm.legacy_id::text AS entity_id,
      wm.legacy_id,
      wm.sent_at AS last_sent_at,
      wm.direction AS last_message_direction,
      public.whatsapp_message_preview_text(
        wm.message, wm.message_type, wm.caption, wm.voice_note, wm.media_filename
      ) AS last_message_preview
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.legacy_id IS NOT NULL
      AND wm.lead_id IS NULL
      AND wm.contact_id IS NULL
      AND (p.skip_vis OR wm.legacy_id IN (SELECT id FROM visible_legacy_lead_ids))
    ORDER BY wm.legacy_id, wm.sent_at DESC
  ),
  legacy_unread AS (
    SELECT
      wm.legacy_id,
      COUNT(*)::bigint AS unread_count
    FROM public.whatsapp_messages wm
    CROSS JOIN params p
    WHERE wm.legacy_id IS NOT NULL
      AND wm.lead_id IS NULL
      AND wm.contact_id IS NULL
      AND wm.direction = 'in'
      AND COALESCE(wm.is_read, false) = false
      AND (p.skip_vis OR wm.legacy_id IN (SELECT id FROM visible_legacy_lead_ids))
    GROUP BY wm.legacy_id
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

NOTIFY pgrst, 'reload schema';
