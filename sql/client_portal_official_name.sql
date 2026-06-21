-- Prefer tenants_employee.official_name for portal "Your team" role labels (fallback: display_name).
-- Run in Supabase SQL editor after client portal migrations.

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

GRANT EXECUTE ON FUNCTION public._portal_employee_display_name(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_contact_by_display_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_employee_photo_by_display_name(TEXT) TO anon, authenticated;
