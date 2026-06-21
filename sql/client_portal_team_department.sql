-- Add employee department to portal "Your team" cards (via portal_get_case_summary).
-- Run in Supabase SQL editor after client_portal_team_contact.sql.

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

-- Re-run portal_get_case_summary from client_portal_team_contact.sql (includes department fields),
-- or deploy the full updated function from that file.

GRANT EXECUTE ON FUNCTION public._portal_employee_department(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_department_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_role_department(BIGINT, TEXT) TO anon, authenticated;
