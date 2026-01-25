-- Add HELPER_HANDLER and DEPARTMENT_MANAGER roles to role_percentages table

-- Insert HELPER_HANDLER role if it doesn't exist
INSERT INTO public.role_percentages (role_name, percentage, description, created_at, updated_at)
VALUES (
  'HELPER_HANDLER',
  0,
  'Helper Handler percentage',
  NOW(),
  NOW()
)
ON CONFLICT (role_name) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = NOW();

-- Insert DEPARTMENT_MANAGER role if it doesn't exist
INSERT INTO public.role_percentages (role_name, percentage, description, created_at, updated_at)
VALUES (
  'DEPARTMENT_MANAGER',
  0,
  'Department Manager percentage',
  NOW(),
  NOW()
)
ON CONFLICT (role_name) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = NOW();
