-- Documents the office still needs from this client.
-- Run in the Supabase SQL editor. Do not run from the app.

CREATE OR REPLACE FUNCTION public.portal_get_client_needed_documents(p_token UUID)
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
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  SELECT COALESCE(
    jsonb_agg(row_to_json(x)::JSONB ORDER BY x.due_date NULLS LAST, x.name),
    '[]'::JSONB
  )
  INTO v_rows
  FROM (
    SELECT
      d.id::TEXT AS id,
      NULLIF(TRIM(d.document_name), '') AS name,
      d.status,
      d.due_date
    FROM public.lead_required_documents d
    WHERE d.status IN ('missing', 'pending', 'rejected')
      AND (d.requested_from IS NULL OR d.requested_from = 'Client')
      AND NULLIF(TRIM(d.document_name), '') IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND d.lead_id::TEXT = v_session.new_lead_id::TEXT)
        OR (v_session.legacy_lead_id IS NOT NULL AND d.legacy_lead_id = v_session.legacy_lead_id::TEXT)
      )
    ORDER BY d.due_date NULLS LAST, d.document_name
    LIMIT 8
  ) x;

  RETURN jsonb_build_object('ok', true, 'documents', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_get_client_needed_documents(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_client_needed_documents(UUID) TO anon, authenticated;
