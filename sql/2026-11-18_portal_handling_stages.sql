-- Case Status in the client portal: who is assigned to each handling role,
-- and which worker is active, so German and Austrian cases can show the three stages.

CREATE OR REPLACE FUNCTION public._portal_handling_person(p_role TEXT, p_employee_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_employee_id IS NULL THEN NULL
    WHEN public._portal_role_display(p_employee_id, NULL) IS NULL THEN NULL
    ELSE jsonb_build_object(
      'role', p_role,
      'name', public._portal_role_display(p_employee_id, NULL),
      'name_he', public._portal_role_display_he(p_employee_id, NULL),
      'photo_url', public._portal_role_photo(p_employee_id, NULL)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public._portal_handling_people(
  p_handler_id BIGINT,
  p_submission_ids BIGINT[],
  p_digital_id BIGINT,
  p_doc_id BIGINT,
  p_cert_id BIGINT,
  p_support_id BIGINT,
  p_authorities_id BIGINT,
  p_completion_id BIGINT
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(person) FILTER (WHERE person IS NOT NULL), '[]'::jsonb)
  FROM (
    SELECT public._portal_handling_person('handler', p_handler_id) AS person
    UNION ALL
    SELECT public._portal_handling_person('submission_manager', id)
    FROM unnest(COALESCE(p_submission_ids, '{}'::bigint[])) AS id
    UNION ALL
    SELECT public._portal_handling_person('digital_case_coordinator', p_digital_id)
    UNION ALL
    SELECT public._portal_handling_person('document_procurement_coordinator', p_doc_id)
    UNION ALL
    SELECT public._portal_handling_person('certification_coordinator', p_cert_id)
    UNION ALL
    SELECT public._portal_handling_person('client_support', p_support_id)
    UNION ALL
    SELECT public._portal_handling_person('authorities_coordinator', p_authorities_id)
    UNION ALL
    SELECT public._portal_handling_person('retainer_handler', p_completion_id)
  ) people;
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
  v_active_handler_type INT;
  v_submission_ids BIGINT[];
  v_digital_id BIGINT;
  v_doc_id BIGINT;
  v_cert_id BIGINT;
  v_support_id BIGINT;
  v_authorities_id BIGINT;
  v_handling_roles JSONB;
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

    SELECT
      ll.active_handler_type::INT,
      CASE
        WHEN cardinality(COALESCE(ll.submission_manager_ids, '{}'::bigint[])) > 0
          THEN ll.submission_manager_ids
        ELSE ARRAY[ll.submission_manager_id]::bigint[]
      END,
      ll.digital_case_coordinator_id,
      ll.document_procurement_coordinator_id,
      ll.certification_coordinator_id,
      ll.client_support_id,
      ll.authorities_coordinator_id
    INTO
      v_active_handler_type,
      v_submission_ids,
      v_digital_id,
      v_doc_id,
      v_cert_id,
      v_support_id,
      v_authorities_id
    FROM public.leads_lead ll
    WHERE ll.id = v_session.legacy_lead_id;
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

    SELECT
      l.active_handler_type::INT,
      CASE
        WHEN cardinality(COALESCE(l.submission_manager_ids, '{}'::bigint[])) > 0
          THEN l.submission_manager_ids
        ELSE ARRAY[l.submission_manager_id]::bigint[]
      END,
      l.digital_case_coordinator_id,
      l.document_procurement_coordinator_id,
      l.certification_coordinator_id,
      l.client_support_id,
      l.authorities_coordinator_id
    INTO
      v_active_handler_type,
      v_submission_ids,
      v_digital_id,
      v_doc_id,
      v_cert_id,
      v_support_id,
      v_authorities_id
    FROM public.leads l
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

  v_handling_roles := public._portal_handling_people(
    v_handler_id,
    v_submission_ids,
    v_digital_id,
    v_doc_id,
    v_cert_id,
    v_support_id,
    v_authorities_id,
    v_retainer_id
  );

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
    'category', v_category,
    'active_handler_type', v_active_handler_type,
    'handling_roles', v_handling_roles
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_case_summary(UUID) TO anon, authenticated;
