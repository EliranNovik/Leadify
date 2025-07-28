-- Setup script for password management system
-- This script ensures all necessary components are in place

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Create index on password_hash for better performance
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);

-- Create a function to verify passwords
CREATE OR REPLACE FUNCTION verify_user_password(
    user_email TEXT,
    password_to_check TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    stored_hash TEXT;
BEGIN
    -- Get the stored password hash
    SELECT password_hash INTO stored_hash 
    FROM users 
    WHERE email = user_email;
    
    -- If no hash found, return false
    IF stored_hash IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Verify the password against the stored hash
    RETURN crypt(password_to_check, stored_hash) = stored_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION verify_user_password(TEXT, TEXT) TO authenticated;

-- Create a function to create new users with password
CREATE OR REPLACE FUNCTION create_user_with_password(
    user_email TEXT,
    user_full_name TEXT,
    user_password TEXT,
    user_role TEXT DEFAULT 'user'
)
RETURNS UUID AS $$
DECLARE
    new_user_id UUID;
    hashed_password TEXT;
BEGIN
    -- Generate a new UUID for the user
    new_user_id := gen_random_uuid();
    
    -- Hash the password
    hashed_password := crypt(user_password, gen_salt('bf'));
    
    -- Insert the new user
    INSERT INTO users (
        id,
        email,
        full_name,
        role,
        password_hash,
        is_active,
        is_staff,
        is_superuser,
        created_at,
        updated_at
    ) VALUES (
        new_user_id,
        user_email,
        user_full_name,
        user_role,
        hashed_password,
        true,
        false,
        false,
        NOW(),
        NOW()
    );
    
    RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_user_with_password(TEXT, TEXT, TEXT, TEXT) TO authenticated; 