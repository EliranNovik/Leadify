-- Fix contact profile uploads: stable storage paths (no slashes in lead folder), storage RLS read on upload tokens.

CREATE OR REPLACE FUNCTION public._portal_storage_lead_key(p_session public.client_portal_sessions)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session.legacy_lead_id IS NOT NULL THEN
    RETURN 'legacy-' || p_session.legacy_lead_id::TEXT;
  END IF;
  IF p_session.new_lead_id IS NOT NULL THEN
    RETURN 'new-' || p_session.new_lead_id::TEXT;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_contact_profile_upload(
  p_token UUID,
  p_contact_id BIGINT,
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
  v_lead_key TEXT;
  v_safe_name TEXT;
  v_storage_path TEXT;
  v_upload_id BIGINT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact is required');
  END IF;

  IF NOT public._portal_contact_belongs_to_session(v_session, p_contact_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact not found');
  END IF;

  IF p_file_name IS NULL OR trim(p_file_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'File name required');
  END IF;

  v_lead_key := public._portal_storage_lead_key(v_session);
  IF v_lead_key IS NULL OR trim(v_lead_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Case not found');
  END IF;

  v_safe_name := regexp_replace(trim(p_file_name), '[^\w.\-()+ ]', '_', 'g');
  v_storage_path := format(
    'contact-profiles/%s/%s/%s_%s',
    v_lead_key,
    p_contact_id,
    extract(epoch from now())::BIGINT,
    v_safe_name
  );

  INSERT INTO public.client_portal_upload_tokens (
    session_id, storage_path, file_name, mime_type, file_size, expires_at
  ) VALUES (
    v_session.id,
    v_storage_path,
    trim(p_file_name),
    p_mime_type,
    p_file_size,
    NOW() + INTERVAL '1 hour'
  )
  RETURNING id INTO v_upload_id;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_id', v_upload_id,
    'storage_path', v_storage_path,
    'bucket', 'client-portal-contact-profiles'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finalize_contact_profile_upload(
  p_token UUID,
  p_contact_id BIGINT,
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
  v_lead_key TEXT;
  v_lead_number TEXT;
  v_expected_prefix TEXT;
  v_legacy_prefix TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF NOT public._portal_contact_belongs_to_session(v_session, p_contact_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact not found');
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

  v_lead_key := public._portal_storage_lead_key(v_session);
  v_expected_prefix := format('contact-profiles/%s/%s/', v_lead_key, p_contact_id);
  v_lead_number := public._portal_lead_number_for_session(v_session);
  v_legacy_prefix := format('contact-profiles/%s/%s/', v_lead_number, p_contact_id);

  IF p_storage_path IS NULL
    OR (
      NOT p_storage_path LIKE v_expected_prefix || '%'
      AND NOT (v_lead_number IS NOT NULL AND p_storage_path LIKE v_legacy_prefix || '%')
    )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid storage path');
  END IF;

  UPDATE public.leads_contact lc
  SET
    portal_profile_image_path = p_storage_path,
    udate = CURRENT_DATE
  WHERE lc.id = p_contact_id;

  UPDATE public.client_portal_upload_tokens
  SET used = TRUE
  WHERE id = v_token_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', p_contact_id,
    'portal_profile_image_path', p_storage_path
  );
END;
$$;

-- Storage policy subqueries need to read pending upload tokens.
DROP POLICY IF EXISTS client_portal_upload_tokens_storage_read ON public.client_portal_upload_tokens;
CREATE POLICY client_portal_upload_tokens_storage_read
  ON public.client_portal_upload_tokens
  FOR SELECT
  TO anon, authenticated
  USING (used = FALSE AND expires_at > NOW());

GRANT EXECUTE ON FUNCTION public._portal_storage_lead_key(public.client_portal_sessions) TO anon, authenticated;

-- Allow storage INSERT policy subqueries to read pending upload tokens (direct anon upload fallback).
DROP POLICY IF EXISTS "staff read contact profile images" ON storage.objects;
CREATE POLICY "staff read contact profile images" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'client-portal-contact-profiles');

DROP POLICY IF EXISTS client_portal_upload_tokens_storage_read ON public.client_portal_upload_tokens;
CREATE POLICY client_portal_upload_tokens_storage_read
  ON public.client_portal_upload_tokens
  FOR SELECT
  TO anon, authenticated, service_role
  USING (used = FALSE AND expires_at > NOW());
