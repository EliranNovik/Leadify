-- Portal schema cast fix: safe text comparisons for mixed bigint/text columns.
-- Run in Supabase SQL editor (replaces prior client_portal_case_summary_fix.sql).

CREATE OR REPLACE FUNCTION public._portal_resolve_lead_ref(p_lead_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := NULLIF(TRIM(p_lead_ref), '');
  v_legacy RECORD;
  v_new RECORD;
  v_stage_name TEXT;
BEGIN
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;

  -- New lead by UUID
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT l.id, l.name, l.lead_number, l.manual_id, l.stage::TEXT
    INTO v_new
    FROM public.leads l
    WHERE l.id = v_ref::UUID
    LIMIT 1;

    IF FOUND THEN
      SELECT ls.name INTO v_stage_name
      FROM public.lead_stages ls
      WHERE ls.id::TEXT = v_new.stage OR ls.name = v_new.stage
      LIMIT 1;

      RETURN jsonb_build_object(
        'is_legacy', false,
        'new_lead_id', v_new.id,
        'legacy_lead_id', NULL,
        'lead_number', COALESCE(NULLIF(TRIM(v_new.lead_number::TEXT), ''), NULLIF(TRIM(v_new.manual_id::TEXT), ''), v_new.id::TEXT),
        'display_name', v_new.name,
        'stage', v_new.stage,
        'stage_name', COALESCE(v_stage_name, v_new.stage)
      );
    END IF;
  END IF;

  -- Legacy by numeric id
  IF v_ref ~ '^\d+$' THEN
    SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
    INTO v_legacy
    FROM public.leads_lead ll
    WHERE ll.id = v_ref::BIGINT
    LIMIT 1;

    IF FOUND THEN
      SELECT ls.name INTO v_stage_name
      FROM public.lead_stages ls
      WHERE ls.id::TEXT = v_legacy.stage::TEXT OR ls.name = v_legacy.stage::TEXT
      LIMIT 1;

      RETURN jsonb_build_object(
        'is_legacy', true,
        'new_lead_id', NULL,
        'legacy_lead_id', v_legacy.id,
        'lead_number', COALESCE(NULLIF(TRIM(v_legacy.lead_number::TEXT), ''), NULLIF(TRIM(v_legacy.manual_id::TEXT), ''), v_legacy.id::TEXT),
        'display_name', v_legacy.name,
        'stage', v_legacy.stage,
        'stage_name', COALESCE(v_stage_name, v_legacy.stage::TEXT)
      );
    END IF;
  END IF;

  -- New lead by lead_number or manual_id
  SELECT l.id, l.name, l.lead_number, l.manual_id, l.stage::TEXT
  INTO v_new
  FROM public.leads l
  WHERE NULLIF(TRIM(l.lead_number::TEXT), '') = v_ref
     OR NULLIF(TRIM(l.manual_id::TEXT), '') = v_ref
  LIMIT 1;

  IF FOUND THEN
    SELECT ls.name INTO v_stage_name
    FROM public.lead_stages ls
    WHERE ls.id::TEXT = v_new.stage OR ls.name = v_new.stage
    LIMIT 1;

    RETURN jsonb_build_object(
      'is_legacy', false,
      'new_lead_id', v_new.id,
      'legacy_lead_id', NULL,
      'lead_number', COALESCE(NULLIF(TRIM(v_new.lead_number::TEXT), ''), NULLIF(TRIM(v_new.manual_id::TEXT), ''), v_new.id::TEXT),
      'display_name', v_new.name,
      'stage', v_new.stage,
      'stage_name', COALESCE(v_stage_name, v_new.stage)
    );
  END IF;

  -- Legacy by lead_number or manual_id
  SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
  INTO v_legacy
  FROM public.leads_lead ll
  WHERE NULLIF(TRIM(ll.lead_number::TEXT), '') = v_ref
     OR NULLIF(TRIM(ll.manual_id::TEXT), '') = v_ref
  LIMIT 1;

  IF FOUND THEN
    SELECT ls.name INTO v_stage_name
    FROM public.lead_stages ls
    WHERE ls.id::TEXT = v_legacy.stage::TEXT OR ls.name = v_legacy.stage::TEXT
    LIMIT 1;

    RETURN jsonb_build_object(
      'is_legacy', true,
      'new_lead_id', NULL,
      'legacy_lead_id', v_legacy.id,
      'lead_number', COALESCE(NULLIF(TRIM(v_legacy.lead_number::TEXT), ''), NULLIF(TRIM(v_legacy.manual_id::TEXT), ''), v_legacy.id::TEXT),
      'display_name', v_legacy.name,
      'stage', v_legacy.stage,
      'stage_name', COALESCE(v_stage_name, v_legacy.stage::TEXT)
    );
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
    RETURN v_contact_id;
  END IF;

  IF p_new_lead_id IS NOT NULL THEN
    SELECT lc.id INTO v_contact_id
    FROM public.leads_contact lc
    INNER JOIN public.lead_leadcontact llc ON llc.contact_id::TEXT = lc.id::TEXT
    WHERE lower(trim(coalesce(lc.email, ''))) = v_email
      AND llc.newlead_id::TEXT = p_new_lead_id::TEXT
    LIMIT 1;
    RETURN v_contact_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._portal_parse_employee_id(p_value TEXT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR TRIM(p_value) IN ('', '---', 'Not assigned') THEN NULL
    WHEN TRIM(p_value) ~ '^[0-9]+$' THEN TRIM(p_value)::BIGINT
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._portal_employee_display_name(p_employee_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(TRIM(te.official_name), ''), NULLIF(TRIM(te.display_name), ''))
  FROM public.tenants_employee te
  WHERE te.id = p_employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_role_display(p_employee_id BIGINT, p_text_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public._portal_employee_display_name(p_employee_id),
    public._portal_employee_display_name(public._portal_parse_employee_id(p_text_value)),
    NULLIF(TRIM(p_text_value), ''),
    NULLIF(TRIM(p_text_value), '---'),
    NULLIF(TRIM(p_text_value), 'Not assigned')
  );
$$;

CREATE OR REPLACE FUNCTION public._portal_employee_photo_url(p_employee_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    COALESCE(NULLIF(TRIM(te.photo_url), ''), NULLIF(TRIM(te.photo), '')),
    ''
  )
  FROM public.tenants_employee te
  WHERE te.id = p_employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_role_photo(p_employee_id BIGINT, p_text_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public._portal_employee_photo_url(p_employee_id),
    public._portal_employee_photo_url(public._portal_parse_employee_id(p_text_value)),
    public._portal_employee_photo_by_display_name(
      CASE
        WHEN p_text_value IS NULL THEN NULL
        WHEN TRIM(p_text_value) IN ('', '---', 'Not assigned') THEN NULL
        WHEN TRIM(p_text_value) ~ '^[0-9]+$' THEN NULL
        ELSE TRIM(p_text_value)
      END
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_get_case_summary(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead JSONB;
  v_expert_name TEXT;
  v_expert_photo TEXT;
  v_handler_name TEXT;
  v_handler_photo TEXT;
  v_scheduler_name TEXT;
  v_scheduler_photo TEXT;
  v_category TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT public._portal_resolve_lead_ref(v_session.legacy_lead_id::TEXT) INTO v_lead;

    SELECT
      public._portal_role_display(public._portal_parse_employee_id(ll.expert_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.expert_id::TEXT), NULL),
      public._portal_role_display(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_display(public._portal_parse_employee_id(ll.meeting_scheduler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.meeting_scheduler_id::TEXT), NULL),
      mc.name
    INTO
      v_expert_name, v_expert_photo,
      v_handler_name, v_handler_photo,
      v_scheduler_name, v_scheduler_photo,
      v_category
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(ll.category_id::TEXT), '')
    WHERE ll.id = v_session.legacy_lead_id;
  ELSE
    SELECT public._portal_resolve_lead_ref(v_session.new_lead_id::TEXT) INTO v_lead;

    SELECT
      public._portal_role_display(public._portal_parse_employee_id(l.expert), l.expert),
      public._portal_role_photo(public._portal_parse_employee_id(l.expert), l.expert),
      public._portal_role_display(
        COALESCE(
          public._portal_parse_employee_id(l.case_handler_id::TEXT),
          public._portal_parse_employee_id(l.handler)
        ),
        l.handler
      ),
      public._portal_role_photo(
        COALESCE(
          public._portal_parse_employee_id(l.case_handler_id::TEXT),
          public._portal_parse_employee_id(l.handler)
        ),
        l.handler
      ),
      public._portal_role_display(public._portal_parse_employee_id(l.scheduler), l.scheduler),
      public._portal_role_photo(public._portal_parse_employee_id(l.scheduler), l.scheduler),
      COALESCE(mc.name, NULLIF(TRIM(l.category::TEXT), ''))
    INTO
      v_expert_name, v_expert_photo,
      v_handler_name, v_handler_photo,
      v_scheduler_name, v_scheduler_photo,
      v_category
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(l.category_id::TEXT), '')
    WHERE l.id = v_session.new_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'lead', v_lead,
    'expert_name', v_expert_name,
    'expert_photo_url', v_expert_photo,
    'handler_name', v_handler_name,
    'handler_photo_url', v_handler_photo,
    'scheduler_name', v_scheduler_name,
    'scheduler_photo_url', v_scheduler_photo,
    'category', v_category
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_sub_efforts(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_rows JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.created_at,
        lse.updated_at
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.created_at DESC
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.created_at,
        lse.updated_at
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT
        AND lse.internal = FALSE
        AND lse.active = TRUE
      ORDER BY lse.created_at DESC
    ) t;
  END IF;

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_finances(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_payments JSONB;
  v_proformas JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.due_date NULLS LAST, t.id), '[]'::JSONB)
    INTO v_payments
    FROM (
      SELECT
        fpr.id,
        fpr.date AS due_date,
        fpr.value,
        fpr.vat_value AS value_vat,
        (fpr.actual_date IS NOT NULL) AS paid,
        fpr.actual_date AS paid_at,
        fpr.client_id AS plan_contact_id,
        ac.name AS currency,
        pl.secure_token,
        pl.status AS link_status,
        pl.expires_at AS link_expires_at,
        TRUE AS is_legacy,
        NULL::TEXT AS public_token,
        NULL::BIGINT AS proforma_id
      FROM public.finances_paymentplanrow fpr
      LEFT JOIN public.accounting_currencies ac ON ac.id::TEXT = NULLIF(TRIM(fpr.currency_id::TEXT), '')
      LEFT JOIN LATERAL (
        SELECT pl2.secure_token, pl2.status, pl2.expires_at
        FROM public.payment_links pl2
        WHERE pl2.payment_plan_id::TEXT = fpr.id::TEXT
          AND pl2.is_legacy_payment_plan = TRUE
        ORDER BY pl2.created_at DESC
        LIMIT 1
      ) pl ON TRUE
      WHERE fpr.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND fpr.cancel_date IS NULL
        AND (
          fpr.actual_date IS NOT NULL
          OR COALESCE(fpr.ready_to_pay, FALSE) = TRUE
        )
    ) t;

    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.id DESC), '[]'::JSONB)
    INTO v_proformas
    FROM (
      SELECT
        pi.id,
        pi.public_token,
        pi.created_at,
        TRUE AS is_legacy
      FROM public.proformainvoice pi
      WHERE pi.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND pi.public_token IS NOT NULL
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.due_date NULLS LAST, t.id), '[]'::JSONB)
    INTO v_payments
    FROM (
      SELECT
        pp.id,
        pp.due_date,
        pp.value,
        pp.value_vat,
        COALESCE(pp.paid, FALSE) AS paid,
        pp.paid_at,
        pp.client_id AS plan_contact_id,
        COALESCE(pp.currency, ac.name, '₪') AS currency,
        pl.secure_token,
        pl.status AS link_status,
        pl.expires_at AS link_expires_at,
        FALSE AS is_legacy,
        pp.public_token,
        NULL::BIGINT AS proforma_id
      FROM public.payment_plans pp
      LEFT JOIN public.accounting_currencies ac ON ac.id::TEXT = NULLIF(TRIM(pp.currency_id::TEXT), '')
      LEFT JOIN LATERAL (
        SELECT pl2.secure_token, pl2.status, pl2.expires_at
        FROM public.payment_links pl2
        WHERE pl2.payment_plan_id::TEXT = pp.id::TEXT
        ORDER BY pl2.created_at DESC
        LIMIT 1
      ) pl ON TRUE
      WHERE pp.lead_id::TEXT = v_session.new_lead_id::TEXT
        AND pp.cancel_date IS NULL
        AND (
          COALESCE(pp.paid, FALSE) = TRUE
          OR COALESCE(pp.ready_to_pay, FALSE) = TRUE
        )
    ) t;

    v_proformas := '[]'::JSONB;
  END IF;

  RETURN jsonb_build_object(
    'payments', v_payments,
    'proformas', v_proformas,
    'is_legacy', v_session.legacy_lead_id IS NOT NULL
  );
END;
$$;

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
        lc.country_id,
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
        lc.country_id,
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
        lc.country_id,
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

GRANT EXECUTE ON FUNCTION public._portal_resolve_lead_ref(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_contact_on_lead(TEXT, UUID, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_parse_employee_id(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_display_name(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_display(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_photo_url(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_photo(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_case_summary(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_sub_efforts(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_finances(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_contacts(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_update_contact(UUID, BIGINT, JSONB) TO anon, authenticated;
