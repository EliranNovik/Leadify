-- Staff open the client portal for a case without the client password.
-- The session is the main contact on that lead. Run in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.portal_staff_enter(
  p_lead_id TEXT,
  p_lead_type TEXT,
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
  v_contact_id BIGINT;
  v_session public.client_portal_sessions;
  v_lead_ref TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'You must be signed in to the CRM to open the client portal.'
    );
  END IF;

  v_ids := public._portal_resolve_staff_lead_ids(p_lead_id, p_lead_type, p_lead_number);
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lead not found for the client portal');
  END IF;

  v_new_lead_id := NULLIF(v_ids->>'new_lead_id', '')::UUID;
  v_legacy_lead_id := NULLIF(v_ids->>'legacy_lead_id', '')::BIGINT;

  IF COALESCE((v_ids->>'is_legacy')::BOOLEAN, FALSE) AND v_legacy_lead_id IS NOT NULL THEN
    SELECT llc.contact_id::BIGINT INTO v_contact_id
    FROM public.lead_leadcontact llc
    WHERE llc.lead_id::TEXT = v_legacy_lead_id::TEXT
      AND llc.contact_id IS NOT NULL
    ORDER BY
      CASE
        WHEN lower(COALESCE(llc.main::TEXT, '')) IN ('true', 't', '1', 'yes') THEN 0
        ELSE 1
      END,
      llc.id
    LIMIT 1;
  ELSIF v_new_lead_id IS NOT NULL THEN
    SELECT llc.contact_id::BIGINT INTO v_contact_id
    FROM public.lead_leadcontact llc
    WHERE llc.newlead_id::TEXT = v_new_lead_id::TEXT
      AND llc.contact_id IS NOT NULL
    ORDER BY
      CASE
        WHEN lower(COALESCE(llc.main::TEXT, '')) IN ('true', 't', '1', 'yes') THEN 0
        ELSE 1
      END,
      llc.id
    LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Add a contact on this lead before opening the client portal.'
    );
  END IF;

  INSERT INTO public.client_portal_sessions (
    contact_id, new_lead_id, legacy_lead_id, expires_at
  ) VALUES (
    v_contact_id,
    CASE WHEN v_legacy_lead_id IS NULL THEN v_new_lead_id ELSE NULL END,
    v_legacy_lead_id,
    NOW() + INTERVAL '12 hours'
  )
  RETURNING * INTO v_session;

  v_lead_ref := COALESCE(
    NULLIF(TRIM(p_lead_number), ''),
    v_legacy_lead_id::TEXT,
    v_new_lead_id::TEXT
  );

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_session.session_token,
    'lead_ref', v_lead_ref,
    'contact_id', v_contact_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_staff_enter(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_staff_enter(TEXT, TEXT, TEXT) TO authenticated;
