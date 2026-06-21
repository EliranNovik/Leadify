-- Fix portal auth: align staff save with public login (resolve by lead_number first).
-- Requires pgcrypto in extensions schema (Supabase default).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.client_portal_access
  ADD COLUMN IF NOT EXISTS password_plain TEXT NULL;

COMMENT ON COLUMN public.client_portal_access.password_plain IS
  'Staff-only copy of client portal password for sharing with contacts. Not used for login verification.';

CREATE OR REPLACE FUNCTION public.portal_hash_password(p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    RETURN extensions.crypt(p_plain, extensions.gen_salt('bf'::text));
  EXCEPTION
    WHEN undefined_function OR invalid_schema_name THEN
      RETURN crypt(p_plain, gen_salt('bf'::text));
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_check_password(p_plain TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    RETURN extensions.crypt(p_plain, p_hash) = p_hash;
  EXCEPTION
    WHEN undefined_function OR invalid_schema_name THEN
      RETURN crypt(p_plain, p_hash) = p_hash;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_hash_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_check_password(TEXT, TEXT) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public._portal_resolve_staff_lead_ids(
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
  v_resolved JSONB;
  v_id TEXT := NULLIF(TRIM(p_lead_id), '');
  v_num TEXT := NULLIF(TRIM(p_lead_number), '');
  v_legacy_id BIGINT;
BEGIN
  -- Same resolution order as portal_login (lead_number / URL ref is canonical).
  IF v_num IS NOT NULL THEN
    v_resolved := public._portal_resolve_lead_ref(v_num);
    IF v_resolved IS NOT NULL THEN
      RETURN jsonb_build_object(
        'is_legacy', COALESCE((v_resolved->>'is_legacy')::BOOLEAN, false),
        'new_lead_id', NULLIF(v_resolved->>'new_lead_id', '')::UUID,
        'legacy_lead_id', NULLIF(v_resolved->>'legacy_lead_id', '')::BIGINT
      );
    END IF;
  END IF;

  IF lower(coalesce(p_lead_type, '')) IN ('legacy', 'auto')
     OR coalesce(v_id, '') ~ '^legacy_' THEN
    BEGIN
      v_legacy_id := regexp_replace(coalesce(v_id, ''), '^legacy_', '')::BIGINT;
      IF EXISTS (SELECT 1 FROM public.leads_lead ll WHERE ll.id = v_legacy_id) THEN
        RETURN jsonb_build_object(
          'is_legacy', true,
          'new_lead_id', NULL,
          'legacy_lead_id', v_legacy_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    IF EXISTS (SELECT 1 FROM public.leads l WHERE l.id = v_id::UUID) THEN
      RETURN jsonb_build_object(
        'is_legacy', false,
        'new_lead_id', v_id::UUID,
        'legacy_lead_id', NULL
      );
    END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    v_resolved := public._portal_resolve_lead_ref(v_id);
    IF v_resolved IS NOT NULL THEN
      RETURN jsonb_build_object(
        'is_legacy', COALESCE((v_resolved->>'is_legacy')::BOOLEAN, false),
        'new_lead_id', NULLIF(v_resolved->>'new_lead_id', '')::UUID,
        'legacy_lead_id', NULLIF(v_resolved->>'legacy_lead_id', '')::BIGINT
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._portal_contact_on_lead(
  p_email TEXT,
  p_new_lead_id UUID,
  p_legacy_lead_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id BIGINT;
  v_email TEXT := lower(trim(p_email));
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NULL;
  END IF;

  IF p_legacy_lead_id IS NOT NULL THEN
    SELECT lc.id INTO v_contact_id
    FROM public.leads_contact lc
    INNER JOIN public.lead_leadcontact llc ON llc.contact_id::TEXT = lc.id::TEXT
    WHERE lower(trim(coalesce(lc.email, ''))) = v_email
      AND llc.lead_id::TEXT = p_legacy_lead_id::TEXT
    LIMIT 1;

    IF v_contact_id IS NULL THEN
      SELECT lc.id INTO v_contact_id
      FROM public.leads_contact lc
      WHERE lower(trim(coalesce(lc.email, ''))) = v_email
        AND lc.newlead_id::TEXT IS NOT NULL
      LIMIT 1;
    END IF;

    RETURN v_contact_id;
  END IF;

  IF p_new_lead_id IS NOT NULL THEN
    SELECT lc.id INTO v_contact_id
    FROM public.leads_contact lc
    INNER JOIN public.lead_leadcontact llc ON llc.contact_id::TEXT = lc.id::TEXT
    WHERE lower(trim(coalesce(lc.email, ''))) = v_email
      AND llc.newlead_id::TEXT = p_new_lead_id::TEXT
    LIMIT 1;

    IF v_contact_id IS NULL THEN
      SELECT lc.id INTO v_contact_id
      FROM public.leads_contact lc
      WHERE lower(trim(coalesce(lc.email, ''))) = v_email
        AND lc.newlead_id::TEXT = p_new_lead_id::TEXT
      LIMIT 1;
    END IF;

    RETURN v_contact_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_login(
  p_lead_ref TEXT,
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead JSONB;
  v_access public.client_portal_access;
  v_contact_id BIGINT;
  v_session public.client_portal_sessions;
  v_new_lead_id UUID;
  v_legacy_lead_id BIGINT;
  v_contact JSONB;
  v_ref TEXT;
BEGIN
  v_ref := NULLIF(TRIM(p_lead_ref), '');
  IF v_ref IS NOT NULL THEN
    v_ref := replace(replace(v_ref, '%2F', '/'), '%2f', '/');
  END IF;

  v_lead := public._portal_resolve_lead_ref(v_ref);
  IF v_lead IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Case not found. Check the portal link with our office.');
  END IF;

  v_new_lead_id := NULLIF(v_lead->>'new_lead_id', '')::UUID;
  v_legacy_lead_id := NULLIF(v_lead->>'legacy_lead_id', '')::BIGINT;

  v_access := public._portal_access_for_lead(v_new_lead_id, v_legacy_lead_id);
  IF v_access IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Client portal is not set up yet. Ask our office to enable it and set a password.'
    );
  END IF;

  IF v_access.password_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid email or password');
  END IF;

  IF NOT public.portal_check_password(p_password, v_access.password_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid email or password');
  END IF;

  v_contact_id := public._portal_contact_on_lead(p_email, v_new_lead_id, v_legacy_lead_id);
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid email or password');
  END IF;

  INSERT INTO public.client_portal_sessions (
    contact_id, new_lead_id, legacy_lead_id, expires_at
  ) VALUES (
    v_contact_id,
    v_new_lead_id,
    v_legacy_lead_id,
    NOW() + INTERVAL '7 days'
  )
  RETURNING * INTO v_session;

  SELECT jsonb_build_object(
    'id', lc.id,
    'name', lc.name,
    'email', lc.email
  ) INTO v_contact
  FROM public.leads_contact lc
  WHERE lc.id = v_contact_id;

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_session.session_token,
    'lead_ref', COALESCE(v_lead->>'lead_number', v_ref),
    'lead_summary', v_lead,
    'contact', v_contact
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Login failed. Please try again.');
END;
$$;

DROP FUNCTION IF EXISTS public.portal_staff_set_password(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.portal_staff_set_password(TEXT, TEXT, TEXT, BOOLEAN, TEXT);

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
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

DROP FUNCTION IF EXISTS public.portal_staff_get_status(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.portal_staff_get_status(TEXT, TEXT, TEXT);

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

GRANT EXECUTE ON FUNCTION public._portal_resolve_staff_lead_ids(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_staff_set_password(TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_staff_get_status(TEXT, TEXT, TEXT) TO authenticated;
