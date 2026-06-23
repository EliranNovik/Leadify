-- =============================================================================
-- Client portal — unified activity / notifications feed
-- -----------------------------------------------------------------------------
-- Aggregates recent activity for the portal session's lead into a single,
-- time-sorted feed the client can review from the header bell:
--   * New POAs + POA signed
--   * New contracts + contract signed
--   * New contacts added
--   * New meetings
--   * New documents uploaded
--   * Case status (sub-effort) added / updated
--
-- Security: SECURITY DEFINER + portal session validation. Everything is scoped
-- to the session's lead (new_lead_id / legacy_lead_id).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.portal_get_notifications(
  p_token UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
  v_rows JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  -- Resolve the lead number (used to match case documents).
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

  SELECT COALESCE(
    jsonb_agg(row_to_json(x)::JSONB ORDER BY x.ts DESC NULLS LAST),
    '[]'::JSONB
  )
  INTO v_rows
  FROM (
    SELECT t.*
    FROM (
    -- ---------------------------------------------------------------- POAs
    SELECT
      ('poa-new-' || d.id::TEXT)            AS id,
      'poa_new'                             AS type,
      COALESCE(pt.name, tpl.name, 'Power of attorney') AS title,
      'New power of attorney to review'     AS subtitle,
      d.created_at                          AS ts,
      'contacts'                            AS tab
    FROM public.poa_documents d
    LEFT JOIN public.poa_types pt ON pt.id = d.poa_type_id
    LEFT JOIN public.poa_templates tpl ON tpl.id = d.template_id
    WHERE d.status <> 'cancelled'
      AND (
        (v_session.new_lead_id IS NOT NULL AND d.new_lead_id = v_session.new_lead_id)
        OR (v_session.legacy_lead_id IS NOT NULL AND d.legacy_lead_id = v_session.legacy_lead_id)
      )

    UNION ALL

    SELECT
      ('poa-signed-' || d.id::TEXT),
      'poa_signed',
      COALESCE(pt.name, tpl.name, 'Power of attorney'),
      'Power of attorney signed',
      d.signed_at,
      'contacts'
    FROM public.poa_documents d
    LEFT JOIN public.poa_types pt ON pt.id = d.poa_type_id
    LEFT JOIN public.poa_templates tpl ON tpl.id = d.template_id
    WHERE d.status = 'signed' AND d.signed_at IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND d.new_lead_id = v_session.new_lead_id)
        OR (v_session.legacy_lead_id IS NOT NULL AND d.legacy_lead_id = v_session.legacy_lead_id)
      )

    UNION ALL

    -- ----------------------------------------------------------- Contracts
    SELECT
      ('contract-new-' || c.id::TEXT),
      'contract_new',
      COALESCE(ct.name, c.contact_name, 'Contract'),
      'New contract available',
      c.created_at::TIMESTAMPTZ,
      'contacts'
    FROM public.contracts c
    LEFT JOIN public.contract_templates ct ON ct.id = c.template_id
    WHERE (
      (v_session.new_lead_id IS NOT NULL AND c.client_id::TEXT = v_session.new_lead_id::TEXT)
      OR (v_session.legacy_lead_id IS NOT NULL AND c.legacy_id::TEXT = v_session.legacy_lead_id::TEXT)
    )

    UNION ALL

    SELECT
      ('contract-signed-' || c.id::TEXT),
      'contract_signed',
      COALESCE(ct.name, c.contact_name, 'Contract'),
      'Contract signed',
      c.signed_at::TIMESTAMPTZ,
      'contacts'
    FROM public.contracts c
    LEFT JOIN public.contract_templates ct ON ct.id = c.template_id
    WHERE c.status = 'signed' AND c.signed_at IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND c.client_id::TEXT = v_session.new_lead_id::TEXT)
        OR (v_session.legacy_lead_id IS NOT NULL AND c.legacy_id::TEXT = v_session.legacy_lead_id::TEXT)
      )

    UNION ALL

    -- ------------------------------------------------------------ Contacts
    SELECT
      ('contact-new-' || lc.id::TEXT),
      'contact_new',
      COALESCE(NULLIF(TRIM(lc.name), ''), 'New contact'),
      'New contact added to your case',
      lc.cdate::TIMESTAMPTZ,
      'contacts'
    FROM public.leads_contact lc
    WHERE lc.cdate IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND (
          lc.newlead_id::TEXT = v_session.new_lead_id::TEXT
          OR EXISTS (
            SELECT 1 FROM public.lead_leadcontact llc
            WHERE llc.contact_id::TEXT = lc.id::TEXT
              AND llc.newlead_id::TEXT = v_session.new_lead_id::TEXT
          )
        ))
        OR (v_session.legacy_lead_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.lead_leadcontact llc
          WHERE llc.contact_id::TEXT = lc.id::TEXT
            AND llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        ))
      )

    UNION ALL

    -- ------------------------------------------------------------ Meetings
    SELECT
      ('meeting-new-' || m.id::TEXT),
      'meeting_new',
      COALESCE(NULLIF(TRIM(m.meeting_subject), ''), 'Meeting'),
      CASE
        WHEN m.meeting_date IS NOT NULL
          THEN 'Meeting scheduled for ' || to_char(m.meeting_date, 'Mon DD, YYYY')
        ELSE 'New meeting scheduled'
      END,
      m.created_at,
      'meetings'
    FROM public.meetings m
    WHERE m.created_at IS NOT NULL
      AND (
        (v_session.new_lead_id IS NOT NULL AND m.client_id = v_session.new_lead_id)
        OR (v_session.legacy_lead_id IS NOT NULL AND m.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT)
      )

    UNION ALL

    -- ----------------------------------------------------------- Documents
    SELECT
      ('document-new-' || d.id::TEXT),
      'document_new',
      COALESCE(NULLIF(TRIM(d.file_name), ''), 'Document'),
      'New document uploaded',
      d.created_at,
      'documents'
    FROM public.lead_case_documents d
    WHERE v_lead_number IS NOT NULL
      AND d.lead_number = v_lead_number
      AND d.storage_path IS NOT NULL
      AND (d.onedrive_subfolder IS NULL OR d.onedrive_subfolder NOT ILIKE '%internal%')

    UNION ALL

    -- -------------------------------------------------- Case status (subs)
    SELECT
      ('status-new-' || lse.id::TEXT),
      'status_new',
      COALESCE(NULLIF(TRIM(se.name), ''), 'Case update'),
      'New case status',
      lse.created_at,
      'stages'
    FROM public.lead_sub_efforts lse
    INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
    WHERE lse.internal = FALSE AND lse.active = TRUE
      AND (
        (v_session.new_lead_id IS NOT NULL AND lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT)
        OR (v_session.legacy_lead_id IS NOT NULL AND lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT)
      )

    UNION ALL

    SELECT
      ('status-upd-' || lse.id::TEXT),
      'status_updated',
      COALESCE(NULLIF(TRIM(se.name), ''), 'Case update'),
      'Case status updated',
      lse.updated_at,
      'stages'
    FROM public.lead_sub_efforts lse
    INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
    WHERE lse.internal = FALSE AND lse.active = TRUE
      AND lse.updated_at IS NOT NULL
      AND lse.updated_at > lse.created_at + INTERVAL '1 minute'
      AND (
        (v_session.new_lead_id IS NOT NULL AND lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT)
        OR (v_session.legacy_lead_id IS NOT NULL AND lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT)
      )
    ) t
    WHERE t.ts IS NOT NULL
    ORDER BY t.ts DESC NULLS LAST
    LIMIT GREATEST(p_limit, 1)
  ) x;

  RETURN jsonb_build_object('ok', true, 'notifications', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_notifications(UUID, INT) TO anon, authenticated;
