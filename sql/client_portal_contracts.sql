-- =============================================================================
-- Client portal — list a contact's contracts (new + legacy)
-- -----------------------------------------------------------------------------
-- Lets a logged-in portal client see the signing contracts attached to one of
-- THEIR contacts, with the public token so they can open / view each one.
--
-- Contracts live in two places:
--   * public.contracts            (new system; UUID id, public_token, status)
--   * public.lead_leadcontact     (legacy; numeric id, contract_html, token)
--
-- Security: SECURITY DEFINER + portal session validation + contact-belongs-to
-- -case check (mirrors portal_update_contact / portal_poa_list_for_contact).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.portal_contract_list_for_contact(
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
  v_rows JSONB;
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

  SELECT COALESCE(
    jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC NULLS LAST),
    '[]'::JSONB
  )
  INTO v_rows
  FROM (
    -- New-system contracts for this contact, scoped to the session's lead.
    SELECT
      c.id::TEXT                                   AS id,
      c.public_token                              AS public_token,
      COALESCE(c.status, 'draft')                 AS status,
      FALSE                                       AS is_legacy,
      COALESCE(ct.name, 'Contract')               AS title,
      c.signed_at::TIMESTAMPTZ                     AS signed_at,
      c.created_at::TIMESTAMPTZ                    AS created_at
    FROM public.contracts c
    LEFT JOIN public.contract_templates ct ON ct.id = c.template_id
    WHERE c.contact_id::TEXT = p_contact_id::TEXT
      AND c.public_token IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND c.client_id::TEXT = v_session.new_lead_id::TEXT)
        OR (v_session.legacy_lead_id IS NOT NULL AND c.legacy_id::TEXT = v_session.legacy_lead_id::TEXT)
      )

    UNION ALL

    -- Legacy contracts stored on the lead/contact junction row.
    SELECT
      llc.id::TEXT                                AS id,
      llc.public_token                            AS public_token,
      CASE
        WHEN llc.signed_contract_html IS NOT NULL
          AND length(btrim(llc.signed_contract_html)) > 0
        THEN 'signed' ELSE 'draft'
      END                                         AS status,
      TRUE                                        AS is_legacy,
      'Contract'                                  AS title,
      NULL::TIMESTAMPTZ                           AS signed_at,
      NULL::TIMESTAMPTZ                           AS created_at
    FROM public.lead_leadcontact llc
    WHERE llc.contact_id::TEXT = p_contact_id::TEXT
      AND llc.public_token IS NOT NULL
      AND (
        llc.contract_html IS NOT NULL
        OR llc.signed_contract_html IS NOT NULL
      )
      AND (
        (v_session.legacy_lead_id IS NOT NULL AND llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT)
        OR (v_session.new_lead_id IS NOT NULL AND llc.newlead_id::TEXT = v_session.new_lead_id::TEXT)
      )
  ) t;

  RETURN jsonb_build_object('ok', true, 'contracts', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_contract_list_for_contact(UUID, BIGINT) TO anon, authenticated;
