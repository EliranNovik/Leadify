-- Script to manually add an admin user
-- Replace 'admin@example.com' with the actual admin email address

-- First, ensure the users table exists (run create_users_table.sql first)
-- Then run this script to add an admin user

INSERT INTO users (email, name, role) 
VALUES ('admin@example.com', 'Admin User', 'admin')
ON CONFLICT (email) 
DO UPDATE SET 
  role = 'admin',
  updated_at = NOW();

-- To check if the user was added successfully:
-- SELECT * FROM users WHERE email = 'admin@example.com'; 