-- =============================================================================
-- Public POA chaining — list a contact's POAs from one document's token
-- -----------------------------------------------------------------------------
-- The public signing page (/poa/:token) uses this to walk the client through
-- every outstanding document for the same contact: after one is signed it opens
-- the next unsigned one, and shows overall progress ("signed all" at the end).
--
-- Security: SECURITY DEFINER. A document token only ever exposes the sibling
-- documents of the SAME contact (the person already signing), and never the
-- field data / signatures of those siblings — just enough to chain + show
-- progress (name, status, token).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.poa_siblings_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact BIGINT;
  v_rows JSONB;
BEGIN
  SELECT contact_id INTO v_contact
  FROM public.poa_documents
  WHERE secure_token = p_token;

  IF v_contact IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POA not found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at ASC), '[]'::JSONB)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.secure_token,
      d.status,
      COALESCE(pt.name, tpl.name) AS type_name,
      d.created_at,
      d.signed_at
    FROM public.poa_documents d
    LEFT JOIN public.poa_types pt ON pt.id = d.poa_type_id
    LEFT JOIN public.poa_templates tpl ON tpl.id = d.template_id
    WHERE d.contact_id = v_contact
      AND d.status <> 'cancelled'
  ) t;

  RETURN jsonb_build_object('ok', true, 'poas', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_siblings_public(TEXT) TO anon, authenticated;
