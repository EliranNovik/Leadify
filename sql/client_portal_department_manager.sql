-- Portal dashboard: resolve department manager from lead main category → tenant_departement (bonuses_role = dm).

DROP FUNCTION IF EXISTS public._portal_resolve_main_category_department(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public._portal_resolve_main_category_department(
  p_category_id TEXT,
  p_category_text TEXT
)
RETURNS TABLE (
  main_category_id BIGINT,
  main_category_name TEXT,
  department_id BIGINT,
  department_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id TEXT := NULLIF(TRIM(p_category_id), '');
  v_category_text TEXT := NULLIF(TRIM(p_category_text), '');
BEGIN
  IF v_category_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      mmc.id::BIGINT,
      mmc.name::TEXT,
      mmc.department_id::BIGINT,
      NULLIF(TRIM(td.name), '')::TEXT
    FROM public.misc_category mc
    INNER JOIN public.misc_maincategory mmc ON mmc.id = mc.parent_id
    LEFT JOIN public.tenant_departement td ON td.id = mmc.department_id
    WHERE mc.id::TEXT = v_category_id
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF v_category_text IS NOT NULL THEN
    RETURN QUERY
    SELECT
      mmc.id::BIGINT,
      mmc.name::TEXT,
      mmc.department_id::BIGINT,
      NULLIF(TRIM(td.name), '')::TEXT
    FROM public.misc_maincategory mmc
    LEFT JOIN public.tenant_departement td ON td.id = mmc.department_id
    WHERE lower(trim(mmc.name)) = lower(v_category_text)
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;

    RETURN QUERY
    SELECT
      mmc.id::BIGINT,
      mmc.name::TEXT,
      mmc.department_id::BIGINT,
      NULLIF(TRIM(td.name), '')::TEXT
    FROM public.misc_category mc
    INNER JOIN public.misc_maincategory mmc ON mmc.id = mc.parent_id
    LEFT JOIN public.tenant_departement td ON td.id = mmc.department_id
    WHERE lower(trim(mc.name)) = lower(v_category_text)
    LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public._portal_department_manager_employee_id(p_department_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT te.id
  FROM public.tenants_employee te
  WHERE p_department_id IS NOT NULL
    AND te.department_id = p_department_id
    AND lower(trim(COALESCE(te.bonuses_role, ''))) IN ('dm', 'department manager')
  ORDER BY te.id
  LIMIT 1;
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
  v_department_manager_name TEXT;
  v_department_manager_photo TEXT;
  v_department_manager_contact JSONB;
  v_department_manager_department TEXT;
  v_category TEXT;
  v_main_category_name TEXT;
  v_department_manager_id BIGINT;
  v_linked_department_id BIGINT;
  v_linked_department_name TEXT;
  v_category_id TEXT;
  v_category_text TEXT;
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
      mc.name,
      NULLIF(TRIM(ll.category_id::TEXT), '')
    INTO
      v_handler_name, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
      v_category, v_category_id
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(ll.category_id::TEXT), '')
    WHERE ll.id = v_session.legacy_lead_id;

    v_category_text := v_category;
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
      COALESCE(mc.name, NULLIF(TRIM(l.category::TEXT), '')),
      NULLIF(TRIM(l.category_id::TEXT), ''),
      NULLIF(TRIM(l.category::TEXT), '')
    INTO
      v_handler_name, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
      v_category, v_category_id, v_category_text
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(l.category_id::TEXT), '')
    WHERE l.id = v_session.new_lead_id;
  END IF;

  SELECT
    r.main_category_name,
    r.department_id,
    r.department_name
  INTO
    v_main_category_name,
    v_linked_department_id,
    v_linked_department_name
  FROM public._portal_resolve_main_category_department(v_category_id, v_category_text) r
  LIMIT 1;

  v_department_manager_id := public._portal_department_manager_employee_id(v_linked_department_id);

  IF v_department_manager_id IS NOT NULL THEN
    v_department_manager_name := public._portal_role_display(v_department_manager_id, NULL);
    v_department_manager_photo := public._portal_role_photo(v_department_manager_id, NULL);
    v_department_manager_contact := public._portal_role_contact(v_department_manager_id, NULL);
    v_department_manager_department := COALESCE(v_linked_department_name, public._portal_role_department(v_department_manager_id, NULL));
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
    'department_manager_name', v_department_manager_name,
    'department_manager_photo_url', v_department_manager_photo,
    'department_manager_contact', v_department_manager_contact,
    'department_manager_department', v_department_manager_department,
    'main_category_name', v_main_category_name,
    'category', v_category
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_resolve_main_category_department(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_department_manager_employee_id(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_case_summary(UUID) TO anon, authenticated;
