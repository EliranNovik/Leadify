-- Public business card RPC for /business-card/:id (mobile share links, anon users)
CREATE OR REPLACE FUNCTION public.get_public_business_card(p_employee_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_employee_id IS NULL OR p_employee_id <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'id', te.id,
    'display_name', te.display_name,
    'official_name', COALESCE(NULLIF(TRIM(te.official_name), ''), te.display_name),
    'photo_url', te.photo_url,
    'chat_background_image_url', te.chat_background_image_url,
    'mobile', COALESCE(te.mobile, ''),
    'phone', COALESCE(te.phone, ''),
    'phone_ext', COALESCE(te.phone_ext, ''),
    'bonuses_role', COALESCE(te.bonuses_role, 'Employee'),
    'linkedin_url', te.linkedin_url,
    'department_name', COALESCE(td.name, 'General'),
    'email', u.email
  )
  INTO result
  FROM tenants_employee te
  LEFT JOIN tenant_departement td ON td.id = te.department_id
  LEFT JOIN users u ON u.employee_id = te.id
  WHERE te.id = p_employee_id
  LIMIT 1;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_business_card(BIGINT) TO anon, authenticated;
