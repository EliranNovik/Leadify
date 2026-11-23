-- Client portal: let the signed-in contact add another person on the same case.
-- Run in the Supabase SQL editor. Do not run from the app.

CREATE OR REPLACE FUNCTION public.portal_create_contact(
  p_token UUID,
  p_fields JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_name TEXT;
  v_contact_id BIGINT;
  v_link_id BIGINT;
  v_has_main BOOLEAN;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  v_name := NULLIF(trim(p_fields->>'name'), '');
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Name is required');
  END IF;

  PERFORM pg_advisory_xact_lock(814220231);

  SELECT COALESCE(MAX(id), 0) + 1 INTO v_contact_id FROM public.leads_contact;
  INSERT INTO public.leads_contact (
    id, name, mobile, phone, email, newlead_id, cdate, udate
  ) VALUES (
    v_contact_id,
    v_name,
    NULLIF(trim(p_fields->>'mobile'), ''),
    NULLIF(trim(p_fields->>'phone'), ''),
    NULLIF(trim(p_fields->>'email'), ''),
    CASE WHEN v_session.legacy_lead_id IS NULL THEN v_session.new_lead_id ELSE NULL END,
    CURRENT_DATE,
    CURRENT_DATE
  );

  SELECT COALESCE(MAX(id), 0) + 1 INTO v_link_id FROM public.lead_leadcontact;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.lead_leadcontact llc
      WHERE llc.lead_id::text = v_session.legacy_lead_id::text
        AND lower(trim(llc.main::text)) IN ('true', 't', '1', 'yes')
    ) INTO v_has_main;

    INSERT INTO public.lead_leadcontact (id, contact_id, lead_id, main)
    VALUES (
      v_link_id,
      v_contact_id,
      v_session.legacy_lead_id,
      CASE WHEN v_has_main THEN 'false' ELSE 'true' END
    );
  ELSE
    INSERT INTO public.lead_leadcontact (id, contact_id, newlead_id, main)
    VALUES (v_link_id, v_contact_id, v_session.new_lead_id, 'false');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_contact_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_create_contact(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_create_contact(UUID, JSONB) TO anon, authenticated;
