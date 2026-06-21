-- Expose employee email / phone / mobile for portal "Your team" cards (via portal_get_case_summary).

CREATE OR REPLACE FUNCTION public._portal_employee_contact(p_employee_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(
    jsonb_build_object(
      'email',
      (
        SELECT NULLIF(TRIM(u.email), '')
        FROM public.users u
        WHERE u.employee_id = te.id
        ORDER BY u.created_at NULLS LAST
        LIMIT 1
      ),
      'phone', NULLIF(TRIM(te.phone), ''),
      'mobile', NULLIF(TRIM(te.mobile), '')
    )
  )
  FROM public.tenants_employee te
  WHERE te.id = p_employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_employee_contact_by_display_name(p_name TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._portal_employee_contact(te.id)
  FROM public.tenants_employee te
  WHERE lower(trim(te.display_name)) = lower(trim(p_name))
     OR lower(trim(te.official_name)) = lower(trim(p_name))
  ORDER BY te.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_role_contact(p_employee_id BIGINT, p_text_value TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public._portal_employee_contact(p_employee_id),
    public._portal_employee_contact(public._portal_parse_employee_id(p_text_value)),
    public._portal_employee_contact_by_display_name(
      CASE
        WHEN p_text_value IS NULL THEN NULL
        WHEN TRIM(p_text_value) IN ('', '---', 'Not assigned') THEN NULL
        WHEN TRIM(p_text_value) ~ '^[0-9]+$' THEN NULL
        ELSE TRIM(p_text_value)
      END
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._portal_employee_department(p_employee_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(TRIM(td.name), '')
  FROM public.tenants_employee te
  LEFT JOIN public.tenant_departement td ON td.id = te.department_id
  WHERE te.id = p_employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_employee_department_by_display_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._portal_employee_department(te.id)
  FROM public.tenants_employee te
  WHERE lower(trim(te.display_name)) = lower(trim(p_name))
     OR lower(trim(te.official_name)) = lower(trim(p_name))
  ORDER BY te.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._portal_role_department(p_employee_id BIGINT, p_text_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    public._portal_employee_department(p_employee_id),
    public._portal_employee_department(public._portal_parse_employee_id(p_text_value)),
    public._portal_employee_department_by_display_name(
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
  v_handler_name TEXT;
  v_handler_photo TEXT;
  v_handler_contact JSONB;
  v_handler_department TEXT;
  v_retainer_handler_name TEXT;
  v_retainer_handler_photo TEXT;
  v_retainer_handler_contact JSONB;
  v_retainer_handler_department TEXT;
  v_meeting_manager_name TEXT;
  v_meeting_manager_photo TEXT;
  v_meeting_manager_contact JSONB;
  v_meeting_manager_department TEXT;
  v_category TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT public._portal_resolve_lead_ref(v_session.legacy_lead_id::TEXT) INTO v_lead;

    SELECT
      public._portal_role_display(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_display(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_display(public._portal_parse_employee_id(ll.meeting_manager_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.meeting_manager_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(ll.meeting_manager_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(ll.meeting_manager_id::TEXT), NULL),
      mc.name
    INTO
      v_handler_name, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
      v_meeting_manager_name, v_meeting_manager_photo, v_meeting_manager_contact, v_meeting_manager_department,
      v_category
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(ll.category_id::TEXT), '')
    WHERE ll.id = v_session.legacy_lead_id;
  ELSE
    SELECT public._portal_resolve_lead_ref(v_session.new_lead_id::TEXT) INTO v_lead;

    SELECT
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
      public._portal_role_contact(
        COALESCE(
          public._portal_parse_employee_id(l.case_handler_id::TEXT),
          public._portal_parse_employee_id(l.handler)
        ),
        l.handler
      ),
      public._portal_role_department(
        COALESCE(
          public._portal_parse_employee_id(l.case_handler_id::TEXT),
          public._portal_parse_employee_id(l.handler)
        ),
        l.handler
      ),
      public._portal_role_display(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_display(
        COALESCE(
          public._portal_parse_employee_id(l.meeting_manager_id::TEXT),
          public._portal_parse_employee_id(l.manager)
        ),
        l.manager
      ),
      public._portal_role_photo(
        COALESCE(
          public._portal_parse_employee_id(l.meeting_manager_id::TEXT),
          public._portal_parse_employee_id(l.manager)
        ),
        l.manager
      ),
      public._portal_role_contact(
        COALESCE(
          public._portal_parse_employee_id(l.meeting_manager_id::TEXT),
          public._portal_parse_employee_id(l.manager)
        ),
        l.manager
      ),
      public._portal_role_department(
        COALESCE(
          public._portal_parse_employee_id(l.meeting_manager_id::TEXT),
          public._portal_parse_employee_id(l.manager)
        ),
        l.manager
      ),
      COALESCE(mc.name, NULLIF(TRIM(l.category::TEXT), ''))
    INTO
      v_handler_name, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
      v_meeting_manager_name, v_meeting_manager_photo, v_meeting_manager_contact, v_meeting_manager_department,
      v_category
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(l.category_id::TEXT), '')
    WHERE l.id = v_session.new_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'lead', v_lead,
    'handler_name', v_handler_name,
    'handler_photo_url', v_handler_photo,
    'handler_contact', v_handler_contact,
    'handler_department', v_handler_department,
    'retainer_handler_name', v_retainer_handler_name,
    'retainer_handler_photo_url', v_retainer_handler_photo,
    'retainer_handler_contact', v_retainer_handler_contact,
    'retainer_handler_department', v_retainer_handler_department,
    'meeting_manager_name', v_meeting_manager_name,
    'meeting_manager_photo_url', v_meeting_manager_photo,
    'meeting_manager_contact', v_meeting_manager_contact,
    'meeting_manager_department', v_meeting_manager_department,
    'category', v_category
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_employee_contact(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_contact_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_contact(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_department(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_department_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_department(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_case_summary(UUID) TO anon, authenticated;
