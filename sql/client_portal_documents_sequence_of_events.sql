-- Portal document uploads: same storage layout + classification as staff DocumentModal.
-- Always classifies uploads as "Sequence of Events".

CREATE OR REPLACE FUNCTION public._portal_sequence_of_events_classification_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.id
  FROM public.case_document_classifications c
  WHERE c.is_active = TRUE
    AND (
      c.slug IN ('sequence_of_events', 'sequence-of-events')
      OR lower(trim(c.label)) = lower('Sequence of Events')
    )
  ORDER BY
    CASE c.slug
      WHEN 'sequence_of_events' THEN 0
      WHEN 'sequence-of-events' THEN 1
      ELSE 2
    END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_document_upload(
  p_token UUID,
  p_file_name TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL
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
  v_classification_id UUID;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF p_file_name IS NULL OR trim(p_file_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'File name required');
  END IF;

  v_classification_id := public._portal_sequence_of_events_classification_id();
  IF v_classification_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Sequence of Events document category is not configured'
    );
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(ll.lead_number::TEXT), ''), ll.id::TEXT)
    INTO v_lead_number
    FROM public.leads_lead ll
    WHERE ll.id = v_session.legacy_lead_id;
  ELSE
    SELECT COALESCE(NULLIF(TRIM(l.lead_number::TEXT), ''), NULLIF(TRIM(l.manual_id::TEXT), ''), l.id::TEXT)
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = v_session.new_lead_id;
  END IF;

  v_safe_name := regexp_replace(trim(p_file_name), '[^\w.\-()+ ]', '_', 'g');
  IF v_safe_name = '' THEN
    v_safe_name := 'file';
  END IF;

  -- Matches `buildCaseDocumentStoragePath(leadNumber, null, fileName)` → case-documents/{lead}/_root/{ms}_{name}
  v_storage_path := format(
    'case-documents/%s/_root/%s_%s',
    v_lead_number,
    (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT,
    v_safe_name
  );

  INSERT INTO public.client_portal_upload_tokens (
    session_id, storage_path, file_name, mime_type, file_size, expires_at
  ) VALUES (
    v_session.id, v_storage_path, trim(p_file_name), p_mime_type, p_file_size, NOW() + INTERVAL '1 hour'
  )
  RETURNING id INTO v_upload_id;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_id', v_upload_id,
    'storage_path', v_storage_path,
    'lead_number', v_lead_number,
    'bucket', 'lead-sub-efforts-documents',
    'classification_id', v_classification_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finalize_document_upload(
  p_token UUID,
  p_storage_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_token_row public.client_portal_upload_tokens;
  v_doc_id UUID;
  v_lead_number TEXT;
  v_classification_id UUID;
  v_uploaded_by TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  SELECT * INTO v_token_row
  FROM public.client_portal_upload_tokens t
  WHERE t.session_id = v_session.id
    AND t.storage_path = p_storage_path
    AND t.used = FALSE
    AND t.expires_at > NOW()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid upload token');
  END IF;

  v_classification_id := public._portal_sequence_of_events_classification_id();
  IF v_classification_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Sequence of Events document category is not configured'
    );
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(ll.lead_number::TEXT), ''), ll.id::TEXT)
    INTO v_lead_number
    FROM public.leads_lead ll
    WHERE ll.id = v_session.legacy_lead_id;
  ELSE
    SELECT COALESCE(NULLIF(TRIM(l.lead_number::TEXT), ''), NULLIF(TRIM(l.manual_id::TEXT), ''), l.id::TEXT)
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = v_session.new_lead_id;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(lc.name), ''), 'Portal client')
  INTO v_uploaded_by
  FROM public.leads_contact lc
  WHERE lc.id = v_session.contact_id;

  INSERT INTO public.lead_case_documents (
    lead_number,
    onedrive_subfolder,
    onedrive_item_id,
    storage_path,
    file_name,
    file_size,
    mime_type,
    classification_id,
    uploaded_by,
    ai_summary_status
  ) VALUES (
    v_lead_number,
    NULL,
    NULL,
    v_token_row.storage_path,
    v_token_row.file_name,
    v_token_row.file_size,
    COALESCE(v_token_row.mime_type, 'application/octet-stream'),
    v_classification_id,
    v_uploaded_by,
    'pending'
  )
  RETURNING id INTO v_doc_id;

  UPDATE public.client_portal_upload_tokens
  SET used = TRUE
  WHERE id = v_token_row.id;

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc_id);
END;
$$;

-- Allow portal uploads to any prepared path (token-validated), not only legacy portal-client folder.
DROP POLICY IF EXISTS "portal-client upload policy" ON storage.objects;
CREATE POLICY "portal-client upload policy" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'lead-sub-efforts-documents'
  AND EXISTS (
    SELECT 1 FROM public.client_portal_upload_tokens t
    WHERE t.storage_path = name
      AND t.used = FALSE
      AND t.expires_at > NOW()
  )
);

GRANT EXECUTE ON FUNCTION public._portal_sequence_of_events_classification_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_prepare_document_upload(UUID, TEXT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_finalize_document_upload(UUID, TEXT) TO anon, authenticated;
