-- Per-lead timeline order for lead_sub_efforts (CRM sub-efforts workflow sidebar).
-- Run in Supabase SQL editor.

ALTER TABLE public.lead_sub_efforts
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.lead_sub_efforts.sort_order IS
  'Display order within a lead timeline (0 = first). Scoped per legacy_lead_id or new_lead_id.';

-- Backfill existing rows: oldest created_at first within each lead.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY COALESCE(new_lead_id::text, 'legacy:' || legacy_lead_id::text)
      ORDER BY created_at ASC, id ASC
    ) - 1 AS rn
  FROM public.lead_sub_efforts
)
UPDATE public.lead_sub_efforts AS lse
SET sort_order = ranked.rn
FROM ranked
WHERE lse.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_lead_sub_efforts_legacy_sort_order
  ON public.lead_sub_efforts (legacy_lead_id, sort_order)
  WHERE legacy_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_sub_efforts_new_lead_sort_order
  ON public.lead_sub_efforts (new_lead_id, sort_order)
  WHERE new_lead_id IS NOT NULL;

-- Client portal: respect CRM timeline order for visible sub-efforts.
CREATE OR REPLACE FUNCTION public.portal_get_sub_efforts(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_rows JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.sort_order ASC, t.created_at ASC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.sort_order,
        lse.created_at,
        lse.updated_at,
        lse.updated_by
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.sort_order ASC, lse.created_at ASC
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.sort_order ASC, t.created_at ASC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.sort_order,
        lse.created_at,
        lse.updated_at,
        lse.updated_by
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.sort_order ASC, lse.created_at ASC
    ) t;
  END IF;

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_sub_efforts(UUID) TO anon, authenticated;
