-- Update users table to support new roles and add full_name column

-- First, add the full_name column
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);

-- Update existing records to copy name to full_name
UPDATE users SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;

-- Drop the old role check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Add new role check constraint with expanded roles
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('user', 'admin', 'handler', 'closer', 'scheduler', 'expert'));

-- Update default role policies to include new roles
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can update user roles" ON users;

-- Recreate admin policies to work with new role structure
CREATE POLICY "Admins can view all users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE email = auth.email() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update user roles" ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE email = auth.email() AND role = 'admin'
    )
  );

-- Update the trigger function to handle full_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (email, name, full_name, role)
  VALUES (
    NEW.email, 
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;