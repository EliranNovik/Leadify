-- Auth user management using Supabase's built-in functions
-- This approach uses triggers and functions that work with Supabase's auth system

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Create a trigger function that will sync users to auth when they're created
CREATE OR REPLACE FUNCTION sync_user_to_auth()
RETURNS TRIGGER AS $$
BEGIN
    -- Only sync if this is a new user with a password_hash
    IF TG_OP = 'INSERT' AND NEW.password_hash IS NOT NULL THEN
        -- Try to create the user in auth using the built-in auth function
        -- This will be handled by the application layer
        RETURN NEW;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to sync users to auth
DROP TRIGGER IF EXISTS sync_user_to_auth_trigger ON users;
CREATE TRIGGER sync_user_to_auth_trigger
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_to_auth();

-- Function to update password and ensure user exists in auth
CREATE OR REPLACE FUNCTION update_user_password_with_auth(
    user_email TEXT,
    new_password TEXT
)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
    user_full_name TEXT;
    user_id UUID;
    result JSON;
BEGIN
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found');
    END IF;
    
    -- Get user details
    SELECT id, full_name INTO user_id, user_full_name FROM users WHERE email = user_email;
    
    -- Hash the password
    hashed_password := crypt(new_password, gen_salt('bf'));
    
    -- Update the password hash in users table
    UPDATE users 
    SET 
        password_hash = hashed_password,
        updated_at = NOW()
    WHERE email = user_email;
    
    -- Check if user exists in auth
    IF EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) THEN
        -- User exists in auth, just update password
        UPDATE auth.users 
        SET 
            encrypted_password = hashed_password,
            updated_at = NOW()
        WHERE email = user_email;
        
        RETURN json_build_object('success', true, 'message', 'Password updated successfully', 'auth_status', 'updated');
    ELSE
        -- User doesn't exist in auth, need to create them
        -- This will be handled by the application layer
        RETURN json_build_object('success', true, 'message', 'Password updated, but user needs to be created in auth system', 'auth_status', 'needs_creation', 'user_id', user_id);
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error updating password: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_user_password_with_auth(TEXT, TEXT) TO authenticated; 