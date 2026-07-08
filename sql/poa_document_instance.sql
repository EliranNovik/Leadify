-- Per-instance POA document content (staff can customize before the client signs).
-- When set, these override the linked template for public rendering.

ALTER TABLE public.poa_documents
  ADD COLUMN IF NOT EXISTS instance_body TEXT NULL,
  ADD COLUMN IF NOT EXISTS instance_fields JSONB NULL,
  ADD COLUMN IF NOT EXISTS instance_direction TEXT NULL,
  ADD COLUMN IF NOT EXISTS instance_font_family TEXT NULL,
  ADD COLUMN IF NOT EXISTS instance_font_size TEXT NULL;

COMMENT ON COLUMN public.poa_documents.instance_body IS 'Staff-edited document text for this POA instance; overrides template body when set.';
COMMENT ON COLUMN public.poa_documents.instance_fields IS 'Staff-edited field definitions for this POA instance; overrides template fields when set.';

-- Snapshot template content when creating from a template.
CREATE OR REPLACE FUNCTION public.poa_create_from_template(
  p_contact_id BIGINT,
  p_template_id UUID,
  p_new_lead_id UUID DEFAULT NULL,
  p_legacy_lead_id BIGINT DEFAULT NULL,
  p_prefill JSONB DEFAULT '{}'::jsonb,
  p_created_by TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl public.poa_templates;
  v_lang TEXT;
  v_id UUID;
  v_token TEXT;
BEGIN
  SELECT * INTO v_tpl FROM public.poa_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown POA template');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leads_contact WHERE id = p_contact_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact not found');
  END IF;

  SELECT lower(l.iso_code) INTO v_lang FROM public.languages l WHERE l.id = v_tpl.language_id;

  INSERT INTO public.poa_documents (
    template_id, contact_id, new_lead_id, legacy_lead_id,
    language, field_data, status, created_by, expires_at,
    instance_body, instance_fields, instance_direction, instance_font_family, instance_font_size
  )
  VALUES (
    p_template_id, p_contact_id, p_new_lead_id, p_legacy_lead_id,
    COALESCE(v_lang, 'en'), COALESCE(p_prefill, '{}'::jsonb), 'pending', p_created_by, p_expires_at,
    v_tpl.body, v_tpl.fields, COALESCE(v_tpl.direction, 'ltr'), v_tpl.font_family, v_tpl.font_size
  )
  RETURNING id, secure_token INTO v_id, v_token;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'secure_token', v_token,
    'template_id', p_template_id,
    'type_name', v_tpl.name
  );
END;
$$;

-- Staff: load a POA instance for editing (template-based only).
CREATE OR REPLACE FUNCTION public.poa_get_for_edit(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poa public.poa_documents;
  v_tpl public.poa_templates;
  v_contact public.leads_contact;
  v_lang TEXT;
  v_body TEXT;
  v_fields JSONB;
  v_direction TEXT;
  v_font_family TEXT;
  v_font_size TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_poa FROM public.poa_documents WHERE secure_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POA not found');
  END IF;

  IF v_poa.template_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This POA type cannot be edited here');
  END IF;

  SELECT * INTO v_tpl FROM public.poa_templates WHERE id = v_poa.template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Template not found');
  END IF;

  SELECT * INTO v_contact FROM public.leads_contact WHERE id = v_poa.contact_id;

  v_body := COALESCE(v_poa.instance_body, v_tpl.body, '');
  v_fields := COALESCE(v_poa.instance_fields, v_tpl.fields, '[]'::jsonb);
  v_direction := COALESCE(v_poa.instance_direction, v_tpl.direction, 'ltr');
  v_font_family := COALESCE(v_poa.instance_font_family, v_tpl.font_family, 'Arial');
  v_font_size := COALESCE(v_poa.instance_font_size, v_tpl.font_size, '15px');
  SELECT lower(l.iso_code) INTO v_lang FROM public.languages l WHERE l.id = v_tpl.language_id;

  RETURN jsonb_build_object(
    'ok', true,
    'poa', jsonb_build_object(
      'id', v_poa.id,
      'secure_token', v_poa.secure_token,
      'status', v_poa.status,
      'template_id', v_poa.template_id,
      'field_data', v_poa.field_data,
      'created_at', v_poa.created_at,
      'signed_at', v_poa.signed_at
    ),
    'document', jsonb_build_object(
      'name', v_tpl.name,
      'description', v_tpl.description,
      'body', v_body,
      'fields', v_fields,
      'direction', v_direction,
      'font_family', v_font_family,
      'font_size', v_font_size,
      'language', COALESCE(v_lang, v_poa.language, 'en')
    ),
    'contact', jsonb_build_object(
      'id', v_contact.id,
      'name', v_contact.name,
      'email', v_contact.email,
      'phone', v_contact.phone,
      'mobile', v_contact.mobile,
      'address', v_contact.address,
      'id_passport', v_contact.id_passport
    ),
    'lead', jsonb_build_object(
      'new_lead_id', v_poa.new_lead_id,
      'legacy_lead_id', v_poa.legacy_lead_id
    ),
    'read_only', (v_poa.status IN ('signed', 'cancelled'))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_get_for_edit(TEXT) TO authenticated;

-- Staff: save per-instance document content (not allowed after signing).
CREATE OR REPLACE FUNCTION public.poa_update_document(
  p_token TEXT,
  p_body TEXT,
  p_fields JSONB,
  p_direction TEXT DEFAULT 'ltr',
  p_font_family TEXT DEFAULT NULL,
  p_font_size TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poa public.poa_documents;
  v_clean_field_data JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_poa FROM public.poa_documents WHERE secure_token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POA not found');
  END IF;

  IF v_poa.template_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This POA type cannot be edited here');
  END IF;

  IF v_poa.status IN ('signed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This POA can no longer be edited');
  END IF;

  -- Drop field_data keys that are no longer defined.
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(k, v_poa.field_data -> k)
      FROM jsonb_object_keys(COALESCE(v_poa.field_data, '{}'::jsonb)) AS k
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb)) AS f
        WHERE f ->> 'key' = k
      )
    ),
    '{}'::jsonb
  )
  INTO v_clean_field_data;

  UPDATE public.poa_documents
  SET
    instance_body = p_body,
    instance_fields = COALESCE(p_fields, '[]'::jsonb),
    instance_direction = COALESCE(NULLIF(TRIM(p_direction), ''), 'ltr'),
    instance_font_family = NULLIF(TRIM(p_font_family), ''),
    instance_font_size = NULLIF(TRIM(p_font_size), ''),
    field_data = v_clean_field_data
  WHERE id = v_poa.id;

  RETURN jsonb_build_object('ok', true, 'id', v_poa.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_update_document(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- Public fetch: prefer instance snapshot over template.
CREATE OR REPLACE FUNCTION public.poa_get_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poa public.poa_documents;
  v_type public.poa_types;
  v_tpl public.poa_templates;
  v_contact public.leads_contact;
  v_lang TEXT;
  v_type_json JSONB;
  v_tpl_json JSONB := NULL;
BEGIN
  SELECT * INTO v_poa FROM public.poa_documents WHERE secure_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POA not found');
  END IF;

  IF v_poa.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This power of attorney is no longer available.');
  END IF;

  IF v_poa.expires_at IS NOT NULL AND v_poa.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This power of attorney link has expired.');
  END IF;

  SELECT * INTO v_contact FROM public.leads_contact WHERE id = v_poa.contact_id;

  IF v_poa.template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM public.poa_templates WHERE id = v_poa.template_id;
    SELECT lower(l.iso_code) INTO v_lang FROM public.languages l WHERE l.id = v_tpl.language_id;
    v_type_json := jsonb_build_object(
      'id', NULL,
      'key', 'template',
      'name', v_tpl.name,
      'language', COALESCE(v_lang, 'en'),
      'direction', COALESCE(v_poa.instance_direction, v_tpl.direction, 'ltr'),
      'jurisdiction', NULL,
      'description', v_tpl.description
    );
    v_tpl_json := jsonb_build_object(
      'id', v_tpl.id,
      'name', v_tpl.name,
      'description', v_tpl.description,
      'body', COALESCE(v_poa.instance_body, v_tpl.body),
      'fields', COALESCE(v_poa.instance_fields, v_tpl.fields),
      'direction', COALESCE(v_poa.instance_direction, v_tpl.direction, 'ltr'),
      'language', COALESCE(v_lang, 'en'),
      'font_family', COALESCE(v_poa.instance_font_family, v_tpl.font_family),
      'font_size', COALESCE(v_poa.instance_font_size, v_tpl.font_size)
    );
  ELSE
    SELECT * INTO v_type FROM public.poa_types WHERE id = v_poa.poa_type_id;
    v_type_json := jsonb_build_object(
      'id', v_type.id,
      'key', v_type.key,
      'name', v_type.name,
      'language', v_type.language,
      'direction', v_type.direction,
      'jurisdiction', v_type.jurisdiction,
      'description', v_type.description
    );
  END IF;

  IF v_poa.status IN ('pending', 'sent') THEN
    UPDATE public.poa_documents
      SET status = 'viewed', viewed_at = COALESCE(viewed_at, now())
      WHERE id = v_poa.id;
    v_poa.status := 'viewed';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'poa', jsonb_build_object(
      'id', v_poa.id,
      'status', v_poa.status,
      'field_data', v_poa.field_data,
      'signatures', v_poa.signatures,
      'signer_name', v_poa.signer_name,
      'signer_email', v_poa.signer_email,
      'signed_at', v_poa.signed_at,
      'created_at', v_poa.created_at
    ),
    'type', v_type_json,
    'template', v_tpl_json,
    'contact', jsonb_build_object(
      'id', v_contact.id,
      'name', v_contact.name,
      'email', v_contact.email,
      'phone', v_contact.phone,
      'mobile', v_contact.mobile,
      'address', v_contact.address,
      'id_passport', v_contact.id_passport
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_get_public(TEXT) TO anon, authenticated;
