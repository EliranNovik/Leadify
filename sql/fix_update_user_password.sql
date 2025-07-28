-- Fix the update_user_password function
-- This script drops the old function and recreates it with correct parameters

-- First, drop the existing function
DROP FUNCTION IF EXISTS update_user_password(TEXT, TEXT);

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Create the updated function with correct parameter names
CREATE OR REPLACE FUNCTION update_user_password(
    user_email TEXT,
    new_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
BEGIN
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RAISE EXCEPTION 'User with email % does not exist', user_email;
    END IF;
    
    -- Hash the password using crypt function (requires pgcrypto extension)
    -- This creates a bcrypt hash that's compatible with Supabase Auth
    hashed_password := crypt(new_password, gen_salt('bf'));
    
    -- Update the password hash in users table
    UPDATE users 
    SET 
        password_hash = hashed_password,
        updated_at = NOW(),
        updated_by = COALESCE(auth.uid(), NULL)  -- Use NULL if current user doesn't exist
    WHERE email = user_email;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_user_password(TEXT, TEXT) TO authenticated; 