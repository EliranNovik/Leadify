-- Portal legal team: hide inactive employees (users.is_active = false / missing active staff user).
-- When inactive, role helpers return NULL so the portal shows an empty slot (UI hides empty boxes).

CREATE OR REPLACE FUNCTION public._portal_employee_is_active(p_employee_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.employee_id = p_employee_id
      AND (
        u.is_active IS TRUE
        OR lower(coalesce(u.is_active::text, '')) IN ('true', 't', '1')
      )
      AND (
        u.is_staff IS TRUE
        OR lower(coalesce(u.is_staff::text, '')) IN ('true', 't', '1')
      )
  );
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
    AND public._portal_employee_is_active(te.id)
  LIMIT 1;
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
    AND public._portal_employee_is_active(te.id)
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
  WHERE (
      lower(trim(te.display_name)) = lower(trim(p_name))
      OR lower(trim(te.official_name)) = lower(trim(p_name))
    )
    AND public._portal_employee_is_active(te.id)
  ORDER BY te.id
  LIMIT 1;
$$;

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
    AND public._portal_employee_is_active(te.id)
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
  WHERE (
      lower(trim(te.display_name)) = lower(trim(p_name))
      OR lower(trim(te.official_name)) = lower(trim(p_name))
    )
    AND public._portal_employee_is_active(te.id)
  ORDER BY te.id
  LIMIT 1;
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
    AND public._portal_employee_is_active(te.id)
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
  WHERE (
      lower(trim(te.display_name)) = lower(trim(p_name))
      OR lower(trim(te.official_name)) = lower(trim(p_name))
    )
    AND public._portal_employee_is_active(te.id)
  ORDER BY te.id
  LIMIT 1;
$$;

-- Role display: only return a name when the resolved employee is active.
-- Do not fall back to raw text when the assigned employee is inactive.
CREATE OR REPLACE FUNCTION public._portal_role_display(p_employee_id BIGINT, p_text_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_employee_id IS NOT NULL THEN
      public._portal_employee_display_name(p_employee_id)
    WHEN public._portal_parse_employee_id(p_text_value) IS NOT NULL THEN
      public._portal_employee_display_name(public._portal_parse_employee_id(p_text_value))
    WHEN NULLIF(TRIM(p_text_value), '') IS NULL
      OR TRIM(p_text_value) IN ('---', 'Not assigned') THEN
      NULL
    WHEN EXISTS (
      SELECT 1
      FROM public.tenants_employee te
      WHERE (
          lower(trim(te.display_name)) = lower(trim(p_text_value))
          OR lower(trim(te.official_name)) = lower(trim(p_text_value))
        )
        AND NOT public._portal_employee_is_active(te.id)
    ) THEN
      NULL
    ELSE
      COALESCE(
        (
          SELECT public._portal_employee_display_name(te.id)
          FROM public.tenants_employee te
          WHERE (
              lower(trim(te.display_name)) = lower(trim(p_text_value))
              OR lower(trim(te.official_name)) = lower(trim(p_text_value))
            )
            AND public._portal_employee_is_active(te.id)
          ORDER BY te.id
          LIMIT 1
        ),
        NULLIF(TRIM(p_text_value), '')
      )
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
    AND public._portal_employee_is_active(te.id)
  ORDER BY te.id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public._portal_employee_is_active(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_display_name(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_photo_url(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_photo_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_contact(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_contact_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_department(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_department_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_display(BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_department_manager_employee_id(BIGINT) TO anon, authenticated;
