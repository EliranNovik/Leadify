-- Resolve role photos when leads.scheduler / expert / handler store display names instead of employee IDs.

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

GRANT EXECUTE ON FUNCTION public._portal_employee_photo_by_display_name(TEXT) TO anon, authenticated;
