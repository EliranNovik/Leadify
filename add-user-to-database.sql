-- Add user to the users table
INSERT INTO public.users (
  email,
  full_name,
  name,
  auth_id,
  created_at,
  updated_at
) VALUES (
  'eliran@lawoffice.org.il',
  'Eliran Novik',
  'Eliran',
  'a772cc0f-4f3a-467e-9515-ee76ec69d5da',
  NOW(),
  NOW()
) ON CONFLICT (email) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Verify the user was added
SELECT * FROM public.users WHERE email = 'eliran@lawoffice.org.il';
