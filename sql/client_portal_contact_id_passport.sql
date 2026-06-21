-- ID / passport number on lead contacts + portal fetch/update support.

ALTER TABLE public.leads_contact
  ADD COLUMN IF NOT EXISTS id_passport TEXT;

COMMENT ON COLUMN public.leads_contact.id_passport IS 'Contact ID or passport number (editable in client portal).';

CREATE OR REPLACE FUNCTION public.portal_get_contacts(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_contacts JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.is_main DESC, t.id), '[]'::JSONB)
    INTO v_contacts
    FROM (
      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        lc.address,
        lc.id_passport,
        lc.country_id,
        lc.portal_profile_image_path,
        (llc.main::TEXT IN ('true', 't', '1')) AS is_main
      FROM public.lead_leadcontact llc
      INNER JOIN public.leads_contact lc ON lc.id::TEXT = llc.contact_id::TEXT
      WHERE llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.is_main DESC, t.id), '[]'::JSONB)
    INTO v_contacts
    FROM (
      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        lc.address,
        lc.id_passport,
        lc.country_id,
        lc.portal_profile_image_path,
        (llc.main::TEXT IN ('true', 't', '1')) AS is_main
      FROM public.lead_leadcontact llc
      INNER JOIN public.leads_contact lc ON lc.id::TEXT = llc.contact_id::TEXT
      WHERE llc.newlead_id::TEXT = v_session.new_lead_id::TEXT

      UNION ALL

      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        lc.address,
        lc.id_passport,
        lc.country_id,
        lc.portal_profile_image_path,
        FALSE AS is_main
      FROM public.leads_contact lc
      WHERE lc.newlead_id::TEXT = v_session.new_lead_id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.lead_leadcontact llc
          WHERE llc.contact_id::TEXT = lc.id::TEXT
            AND llc.newlead_id::TEXT = v_session.new_lead_id::TEXT
        )
    ) t;
  END IF;

  RETURN jsonb_build_object('contacts', v_contacts);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_update_contact(
  p_token UUID,
  p_contact_id BIGINT,
  p_fields JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_on_lead BOOLEAN := FALSE;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.lead_leadcontact llc
      WHERE llc.contact_id::TEXT = p_contact_id::TEXT AND llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
    ) INTO v_on_lead;
  ELSE
    SELECT (
      EXISTS (
        SELECT 1 FROM public.lead_leadcontact llc
        WHERE llc.contact_id::TEXT = p_contact_id::TEXT
          AND llc.newlead_id::TEXT = v_session.new_lead_id::TEXT
      )
      OR EXISTS (
        SELECT 1 FROM public.leads_contact lc
        WHERE lc.id = p_contact_id AND lc.newlead_id::TEXT = v_session.new_lead_id::TEXT
      )
    ) INTO v_on_lead;
  END IF;

  IF NOT v_on_lead THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact not found');
  END IF;

  UPDATE public.leads_contact lc
  SET
    name = COALESCE(NULLIF(trim(p_fields->>'name'), ''), lc.name),
    mobile = CASE WHEN p_fields ? 'mobile' THEN NULLIF(trim(p_fields->>'mobile'), '') ELSE lc.mobile END,
    phone = CASE WHEN p_fields ? 'phone' THEN NULLIF(trim(p_fields->>'phone'), '') ELSE lc.phone END,
    email = CASE WHEN p_fields ? 'email' THEN NULLIF(trim(p_fields->>'email'), '') ELSE lc.email END,
    address = CASE WHEN p_fields ? 'address' THEN NULLIF(trim(p_fields->>'address'), '') ELSE lc.address END,
    id_passport = CASE WHEN p_fields ? 'id_passport' THEN NULLIF(trim(p_fields->>'id_passport'), '') ELSE lc.id_passport END,
    country_id = CASE
      WHEN p_fields ? 'country_id' AND (p_fields->>'country_id') ~ '^\d+$'
      THEN (p_fields->>'country_id')::BIGINT
      ELSE lc.country_id
    END,
    udate = CURRENT_DATE
  WHERE lc.id = p_contact_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_contacts(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_update_contact(UUID, BIGINT, JSONB) TO anon, authenticated;
