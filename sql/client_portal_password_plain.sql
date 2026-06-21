-- Store retrievable portal password for staff (bcrypt hash alone cannot be reversed).

ALTER TABLE public.client_portal_access
  ADD COLUMN IF NOT EXISTS password_plain TEXT NULL;

COMMENT ON COLUMN public.client_portal_access.password_plain IS
  'Staff-only copy of client portal password for sharing with contacts. Not used for login verification.';

CREATE OR REPLACE FUNCTION public.portal_staff_set_password(
  p_lead_id TEXT,
  p_lead_type TEXT,
  p_password TEXT,
  p_enabled BOOLEAN DEFAULT TRUE,
  p_lead_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids JSONB;
  v_new_lead_id UUID;
  v_legacy_lead_id BIGINT;
  v_hash TEXT;
  v_row public.client_portal_access;
  v_pwd TEXT := NULLIF(TRIM(p_password), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'You must be signed in to the CRM to save portal settings. Try refreshing the page.'
    );
  END IF;

  v_ids := public._portal_resolve_staff_lead_ids(p_lead_id, p_lead_type, p_lead_number);
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lead not found for portal setup');
  END IF;

  v_new_lead_id := NULLIF(v_ids->>'new_lead_id', '')::UUID;
  v_legacy_lead_id := NULLIF(v_ids->>'legacy_lead_id', '')::BIGINT;

  IF (v_ids->>'is_legacy')::BOOLEAN THEN
    SELECT * INTO v_row
    FROM public.client_portal_access
    WHERE legacy_lead_id = v_legacy_lead_id
    LIMIT 1;
  ELSE
    SELECT * INTO v_row
    FROM public.client_portal_access
    WHERE new_lead_id = v_new_lead_id
    LIMIT 1;
  END IF;

  IF v_pwd IS NULL THEN
    IF v_row IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Password is required when setting up the portal');
    END IF;
    UPDATE public.client_portal_access
    SET
      enabled = COALESCE(p_enabled, TRUE),
      updated_at = NOW(),
      updated_by = auth.uid()::TEXT
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'enabled', v_row.enabled, 'updated_at', v_row.updated_at);
  END IF;

  IF length(v_pwd) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Password must be at least 6 characters');
  END IF;

  v_hash := public.portal_hash_password(v_pwd);

  IF (v_ids->>'is_legacy')::BOOLEAN THEN
    UPDATE public.client_portal_access
    SET
      password_hash = v_hash,
      password_plain = v_pwd,
      enabled = COALESCE(p_enabled, TRUE),
      updated_at = NOW(),
      updated_by = auth.uid()::TEXT
    WHERE legacy_lead_id = v_legacy_lead_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      INSERT INTO public.client_portal_access (legacy_lead_id, password_hash, password_plain, enabled, updated_by)
      VALUES (v_legacy_lead_id, v_hash, v_pwd, COALESCE(p_enabled, TRUE), auth.uid()::TEXT)
      RETURNING * INTO v_row;
    END IF;
  ELSE
    UPDATE public.client_portal_access
    SET
      password_hash = v_hash,
      password_plain = v_pwd,
      enabled = COALESCE(p_enabled, TRUE),
      updated_at = NOW(),
      updated_by = auth.uid()::TEXT
    WHERE new_lead_id = v_new_lead_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      INSERT INTO public.client_portal_access (new_lead_id, password_hash, password_plain, enabled, updated_by)
      VALUES (v_new_lead_id, v_hash, v_pwd, COALESCE(p_enabled, TRUE), auth.uid()::TEXT)
      RETURNING * INTO v_row;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'enabled', v_row.enabled, 'updated_at', v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_staff_get_status(
  p_lead_id TEXT,
  p_lead_type TEXT,
  p_lead_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids JSONB;
  v_row public.client_portal_access;
  v_lead_ref TEXT;
  v_new_lead_id UUID;
  v_legacy_lead_id BIGINT;
BEGIN
  v_ids := public._portal_resolve_staff_lead_ids(p_lead_id, p_lead_type, p_lead_number);
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', true,
      'has_password', false,
      'password_plain', NULL,
      'lead_ref', COALESCE(p_lead_number, p_lead_id)
    );
  END IF;

  v_new_lead_id := NULLIF(v_ids->>'new_lead_id', '')::UUID;
  v_legacy_lead_id := NULLIF(v_ids->>'legacy_lead_id', '')::BIGINT;

  IF (v_ids->>'is_legacy')::BOOLEAN THEN
    SELECT * INTO v_row
    FROM public.client_portal_access
    WHERE legacy_lead_id = v_legacy_lead_id
    LIMIT 1;

    SELECT COALESCE(NULLIF(TRIM(lead_number::TEXT), ''), id::TEXT)
    INTO v_lead_ref
    FROM public.leads_lead
    WHERE id = v_legacy_lead_id;
  ELSE
    SELECT * INTO v_row
    FROM public.client_portal_access
    WHERE new_lead_id = v_new_lead_id
    LIMIT 1;

    SELECT COALESCE(NULLIF(TRIM(lead_number::TEXT), ''), NULLIF(TRIM(manual_id::TEXT), ''), id::TEXT)
    INTO v_lead_ref
    FROM public.leads
    WHERE id = v_new_lead_id;
  END IF;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', true,
      'has_password', false,
      'password_plain', NULL,
      'lead_ref', COALESCE(v_lead_ref, p_lead_number, p_lead_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'enabled', v_row.enabled,
    'has_password', v_row.password_hash IS NOT NULL,
    'password_plain', NULLIF(TRIM(v_row.password_plain), ''),
    'updated_at', v_row.updated_at,
    'lead_ref', COALESCE(v_lead_ref, p_lead_number, p_lead_id)
  );
END;
$$;
