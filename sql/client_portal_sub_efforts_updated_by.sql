-- Add updated_by to portal_get_sub_efforts for client portal Case Status detail panel.
-- Run in Supabase SQL editor after client_portal.sql.

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
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.created_at,
        lse.updated_at,
        lse.updated_by
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.created_at DESC
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.created_at,
        lse.updated_at,
        lse.updated_by
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.created_at DESC
    ) t;
  END IF;

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_sub_efforts(UUID) TO anon, authenticated;
