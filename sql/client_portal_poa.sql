-- =============================================================================
-- Client portal — list a contact's Power of Attorney documents
-- -----------------------------------------------------------------------------
-- Lets a logged-in portal client see the POAs attached to one of THEIR contacts
-- (with the public secure_token so they can open / fill / view each one).
--
-- Security: SECURITY DEFINER + portal session validation + contact-belongs-to
-- -case check (mirrors portal_update_contact).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.portal_poa_list_for_contact(
  p_token UUID,
  p_contact_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_on_lead BOOLEAN := FALSE;
  v_poas JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  -- The contact must belong to the session's lead.
  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.lead_leadcontact llc
      WHERE llc.contact_id::TEXT = p_contact_id::TEXT
        AND llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
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

  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
  INTO v_poas
  FROM (
    SELECT
      d.id,
      d.secure_token,
      d.status,
      COALESCE(pt.name, tpl.name) AS type_name,
      d.signed_at,
      d.created_at
    FROM public.poa_documents d
    LEFT JOIN public.poa_types pt ON pt.id = d.poa_type_id
    LEFT JOIN public.poa_templates tpl ON tpl.id = d.template_id
    WHERE d.contact_id = p_contact_id
      AND d.status <> 'cancelled'
  ) t;

  RETURN jsonb_build_object('ok', true, 'poas', v_poas);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_poa_list_for_contact(UUID, BIGINT) TO anon, authenticated;
