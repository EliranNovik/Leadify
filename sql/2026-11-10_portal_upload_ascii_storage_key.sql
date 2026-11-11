-- Portal document uploads: storage object keys must be ASCII.
-- Postgres \w matches Hebrew letters, so the old safe-name regex left them in the path
-- and Storage returned 400 Invalid key. The original file name is still stored for display.
-- Run in the Supabase SQL editor.

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

  IF p_document_type_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_case_document_types t
      WHERE t.id = p_document_type_id
        AND t.active = TRUE
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This document type is not available. Please choose another type.'
      );
    END IF;
    v_document_type_id := p_document_type_id;
  ELSE
    v_document_type_id := NULL;
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

  -- Storage rejects non-ASCII keys. Keep letters, digits, and a few safe marks only.
  v_safe_name := regexp_replace(trim(p_file_name), '[^A-Za-z0-9._()+ -]', '_', 'g');
  v_safe_name := regexp_replace(v_safe_name, '_+', '_', 'g');
  v_safe_name := trim(both ' _' FROM v_safe_name);
  IF v_safe_name IS NULL OR v_safe_name = '' OR v_safe_name ~ '^\.+$' THEN
    v_safe_name := 'file';
  ELSIF v_safe_name ~ '^\.' THEN
    v_safe_name := 'file' || v_safe_name;
  END IF;
  v_safe_name := left(v_safe_name, 180);

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

GRANT EXECUTE ON FUNCTION public.portal_prepare_document_upload(UUID, TEXT, TEXT, BIGINT, BIGINT, UUID) TO anon, authenticated;
