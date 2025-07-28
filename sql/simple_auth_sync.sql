-- Simple password update with auth sync instructions
-- This approach updates the password and provides guidance for auth user creation

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Simple password update function
CREATE OR REPLACE FUNCTION update_user_password_simple(
    user_email TEXT,
    new_password TEXT
)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
    user_id UUID;
    auth_exists BOOLEAN;
BEGIN
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in users table');
    END IF;
    
    -- Get user ID
    SELECT id INTO user_id FROM users WHERE email = user_email;
    
    -- Check if user exists in auth
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO auth_exists;
    
    -- Hash the password
    hashed_password := crypt(new_password, gen_salt('bf'));
    
    -- Update the password hash in users table
    UPDATE users 
    SET 
        password_hash = hashed_password,
        updated_at = NOW()
    WHERE email = user_email;
    
    -- Return result with auth status
    IF auth_exists THEN
        RETURN json_build_object(
            'success', true, 
            'message', 'Password updated successfully. User exists in auth system.',
            'auth_status', 'exists',
            'user_id', user_id
        );
    ELSE
        RETURN json_build_object(
            'success', true, 
            'message', 'Password updated successfully. User needs to be created in auth system.',
            'auth_status', 'missing',
            'user_id', user_id,
            'instructions', 'Use Supabase Dashboard or service role key to create user in auth system'
        );
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_user_password_simple(TEXT, TEXT) TO authenticated; 