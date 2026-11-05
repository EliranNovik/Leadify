-- Hebrew display name for staff shown in the client portal (and elsewhere).
-- English names stay in display_name / official_name; portal picks *_he when locale is Hebrew.

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS display_name_he TEXT;

COMMENT ON COLUMN public.tenants_employee.display_name_he IS
  'Optional Hebrew display name for client portal / bilingual UI. Falls back to official_name / display_name when empty.';

-- Return ONLY the Hebrew column (null when unset). Portal UI falls back to English.
CREATE OR REPLACE FUNCTION public._portal_employee_display_name_he(p_employee_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(TRIM(te.display_name_he), '')
  FROM public.tenants_employee te
  WHERE te.id = p_employee_id
    AND public._portal_employee_is_active(te.id)
  LIMIT 1;
$$;

-- Mirror of _portal_role_display, preferring display_name_he when set.
CREATE OR REPLACE FUNCTION public._portal_role_display_he(p_employee_id BIGINT, p_text_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_employee_id IS NOT NULL THEN
      public._portal_employee_display_name_he(p_employee_id)
    WHEN public._portal_parse_employee_id(p_text_value) IS NOT NULL THEN
      public._portal_employee_display_name_he(public._portal_parse_employee_id(p_text_value))
    WHEN NULLIF(TRIM(p_text_value), '') IS NULL
      OR TRIM(p_text_value) IN ('---', 'Not assigned') THEN
      NULL
    WHEN EXISTS (
      SELECT 1
      FROM public.tenants_employee te
      WHERE (
          lower(trim(te.display_name)) = lower(trim(p_text_value))
          OR lower(trim(te.official_name)) = lower(trim(p_text_value))
          OR lower(trim(coalesce(te.display_name_he, ''))) = lower(trim(p_text_value))
        )
        AND NOT public._portal_employee_is_active(te.id)
    ) THEN
      NULL
    ELSE
      (
        SELECT public._portal_employee_display_name_he(te.id)
        FROM public.tenants_employee te
        WHERE (
            lower(trim(te.display_name)) = lower(trim(p_text_value))
            OR lower(trim(te.official_name)) = lower(trim(p_text_value))
            OR lower(trim(coalesce(te.display_name_he, ''))) = lower(trim(p_text_value))
          )
          AND public._portal_employee_is_active(te.id)
        ORDER BY te.id
        LIMIT 1
      )
  END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_employee_display_name_he(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_display_he(BIGINT, TEXT) TO anon, authenticated;

-- Extend case summary with Hebrew names for the legal-team cards.
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
  v_handler_name_he TEXT;
  v_handler_photo TEXT;
  v_handler_contact JSONB;
  v_handler_department TEXT;
  v_retainer_handler_name TEXT;
  v_retainer_handler_name_he TEXT;
  v_retainer_handler_photo TEXT;
  v_retainer_handler_contact JSONB;
  v_retainer_handler_department TEXT;
  v_department_manager_name TEXT;
  v_department_manager_name_he TEXT;
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
  v_handler_id BIGINT;
  v_retainer_id BIGINT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT public._portal_resolve_lead_ref(v_session.legacy_lead_id::TEXT) INTO v_lead;

    SELECT
      public._portal_parse_employee_id(ll.case_handler_id::TEXT),
      public._portal_parse_employee_id(ll.retainer_handler_id::TEXT),
      public._portal_role_display(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_display_he(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(ll.case_handler_id::TEXT), NULL),
      public._portal_role_display(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_display_he(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(ll.retainer_handler_id::TEXT), NULL),
      mc.name,
      NULLIF(TRIM(ll.category_id::TEXT), '')
    INTO
      v_handler_id, v_retainer_id,
      v_handler_name, v_handler_name_he, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_name_he, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
      v_category, v_category_id
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id::TEXT = NULLIF(TRIM(ll.category_id::TEXT), '')
    WHERE ll.id = v_session.legacy_lead_id;

    v_category_text := v_category;
  ELSE
    SELECT public._portal_resolve_lead_ref(v_session.new_lead_id::TEXT) INTO v_lead;

    SELECT
      COALESCE(
        public._portal_parse_employee_id(l.case_handler_id::TEXT),
        public._portal_parse_employee_id(l.handler)
      ),
      public._portal_parse_employee_id(l.retainer_handler_id::TEXT),
      public._portal_role_display(
        COALESCE(
          public._portal_parse_employee_id(l.case_handler_id::TEXT),
          public._portal_parse_employee_id(l.handler)
        ),
        l.handler
      ),
      public._portal_role_display_he(
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
      public._portal_role_display_he(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_photo(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_contact(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      public._portal_role_department(public._portal_parse_employee_id(l.retainer_handler_id::TEXT), NULL),
      COALESCE(mc.name, NULLIF(TRIM(l.category::TEXT), '')),
      NULLIF(TRIM(l.category_id::TEXT), ''),
      NULLIF(TRIM(l.category::TEXT), '')
    INTO
      v_handler_id, v_retainer_id,
      v_handler_name, v_handler_name_he, v_handler_photo, v_handler_contact, v_handler_department,
      v_retainer_handler_name, v_retainer_handler_name_he, v_retainer_handler_photo, v_retainer_handler_contact, v_retainer_handler_department,
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
    v_department_manager_name_he := public._portal_role_display_he(v_department_manager_id, NULL);
    v_department_manager_photo := public._portal_role_photo(v_department_manager_id, NULL);
    v_department_manager_contact := public._portal_role_contact(v_department_manager_id, NULL);
    v_department_manager_department := COALESCE(v_linked_department_name, public._portal_role_department(v_department_manager_id, NULL));
  END IF;

  RETURN jsonb_build_object(
    'lead', v_lead,
    'handler_name', v_handler_name,
    'handler_name_he', v_handler_name_he,
    'handler_photo_url', v_handler_photo,
    'handler_contact', v_handler_contact,
    'handler_department', v_handler_department,
    'retainer_handler_name', v_retainer_handler_name,
    'retainer_handler_name_he', v_retainer_handler_name_he,
    'retainer_handler_photo_url', v_retainer_handler_photo,
    'retainer_handler_contact', v_retainer_handler_contact,
    'retainer_handler_department', v_retainer_handler_department,
    'department_manager_name', v_department_manager_name,
    'department_manager_name_he', v_department_manager_name_he,
    'department_manager_photo_url', v_department_manager_photo,
    'department_manager_contact', v_department_manager_contact,
    'department_manager_department', v_department_manager_department,
    'main_category_name', v_main_category_name,
    'category', v_category
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_case_summary(UUID) TO anon, authenticated;
