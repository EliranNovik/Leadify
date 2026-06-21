-- Add employee profile photos to portal case summary (Expert / Handler / Scheduler).

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

CREATE OR REPLACE FUNCTION public._portal_employee_photo_by_display_name(p_name TEXT)
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
  WHERE lower(trim(te.display_name)) = lower(trim(p_name))
     OR lower(trim(te.official_name)) = lower(trim(p_name))
  ORDER BY te.id
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

GRANT EXECUTE ON FUNCTION public._portal_employee_photo_url(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_photo(BIGINT, TEXT) TO anon, authenticated;
