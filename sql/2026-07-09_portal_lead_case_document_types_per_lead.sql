-- Portal document type dropdown: only types added for this lead in CRM (lead_case_document_type_assignments).
-- Run in Supabase SQL editor after lead_case_document_type_assignments exists.

CREATE OR REPLACE FUNCTION public._portal_lead_number_from_session(p_session public.client_portal_sessions)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lead_number TEXT;
BEGIN
  IF p_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(ll.lead_number::TEXT), ''), ll.id::TEXT)
    INTO v_lead_number
    FROM public.leads_lead ll
    WHERE ll.id = p_session.legacy_lead_id;
  ELSE
    SELECT COALESCE(
      NULLIF(TRIM(l.lead_number::TEXT), ''),
      NULLIF(TRIM(l.manual_id::TEXT), ''),
      l.id::TEXT
    )
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = p_session.new_lead_id;
  END IF;

  RETURN v_lead_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_lead_case_document_types(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_lead_number := public._portal_lead_number_from_session(v_session);

  RETURN jsonb_build_object(
    'types',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'sort_order', a.sort_order
          )
          ORDER BY a.sort_order, t.name
        )
        FROM public.lead_case_document_type_assignments a
        INNER JOIN public.lead_case_document_types t
          ON t.id = a.document_type_id
         AND t.active = TRUE
        WHERE a.lead_number = v_lead_number
      ),
      '[]'::JSONB
    ),
    'lead_number', v_lead_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_document_upload(
  p_token UUID,
  p_file_name TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL,
  p_contact_id BIGINT DEFAULT NULL,
  p_document_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
  v_safe_name TEXT;
  v_storage_path TEXT;
  v_upload_id BIGINT;
  v_contact_id BIGINT;
  v_document_type_id UUID;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF p_file_name IS NULL OR trim(p_file_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'File name required');
  END IF;

  v_lead_number := public._portal_lead_number_from_session(v_session);
  IF v_lead_number IS NULL OR trim(v_lead_number) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lead not found');
  END IF;

  v_contact_id := COALESCE(p_contact_id, v_session.contact_id);
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact is required');
  END IF;

  IF p_document_type_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Document type is required');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lead_case_document_type_assignments a
    INNER JOIN public.lead_case_document_types t
      ON t.id = a.document_type_id
     AND t.active = TRUE
    WHERE a.lead_number = v_lead_number
      AND a.document_type_id = p_document_type_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'This document type is not available for your case. Please contact your case manager.'
    );
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_leadcontact llc
      WHERE llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND llc.contact_id::TEXT = v_contact_id::TEXT
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contact does not belong to this case');
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_leadcontact llc
      WHERE llc.newlead_id::TEXT = v_session.new_lead_id::TEXT
        AND llc.contact_id::TEXT = v_contact_id::TEXT
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.leads_contact lc
      WHERE lc.id = v_contact_id
        AND lc.newlead_id::TEXT = v_session.new_lead_id::TEXT
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contact does not belong to this case');
    END IF;
  END IF;

  v_document_type_id := p_document_type_id;

  v_safe_name := regexp_replace(trim(p_file_name), '[^\w.\-()+ ]', '_', 'g');
  v_storage_path := format(
    'case-documents/%s/portal-client/%s_%s',
    v_lead_number,
    extract(epoch from now())::BIGINT,
    v_safe_name
  );

  INSERT INTO public.client_portal_upload_tokens (
    session_id,
    storage_path,
    file_name,
    mime_type,
    file_size,
    expires_at,
    contact_id,
    document_type_id
  ) VALUES (
    v_session.id,
    v_storage_path,
    trim(p_file_name),
    p_mime_type,
    p_file_size,
    NOW() + INTERVAL '1 hour',
    v_contact_id,
    v_document_type_id
  )
  RETURNING id INTO v_upload_id;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_id', v_upload_id,
    'storage_path', v_storage_path,
    'lead_number', v_lead_number,
    'bucket', 'lead-sub-efforts-documents',
    'contact_id', v_contact_id,
    'document_type_id', v_document_type_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_lead_number_from_session(public.client_portal_sessions) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_lead_case_document_types(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_prepare_document_upload(UUID, TEXT, TEXT, BIGINT, BIGINT, UUID) TO anon, authenticated;
