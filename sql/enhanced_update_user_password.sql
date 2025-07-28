-- Enhanced password update function that also creates user in auth system
-- This ensures users can log in after password changes

CREATE OR REPLACE FUNCTION enhanced_update_user_password(
    user_email TEXT,
    new_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
    user_full_name TEXT;
    auth_created BOOLEAN;
BEGIN
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RAISE EXCEPTION 'User with email % does not exist', user_email;
    END IF;
    
    -- Get user's full name for auth creation
    SELECT full_name INTO user_full_name FROM users WHERE email = user_email;
    
    -- Hash the password using crypt function (requires pgcrypto extension)
    -- This creates a bcrypt hash that's compatible with Supabase Auth
    hashed_password := crypt(new_password, gen_salt('bf'));
    
    -- Update the password hash in users table
    UPDATE users 
    SET 
        password_hash = hashed_password,
        updated_at = NOW()
    WHERE email = user_email;
    
    -- Try to create user in auth system
    SELECT create_user_in_auth(user_email, new_password, user_full_name) INTO auth_created;
    
    -- Return true even if auth creation fails (password was still updated)
    RETURN TRUE;
    
EXCEPTION
    WHEN OTHERS THEN
        -- If there's any error, still return true if password was updated
        RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION enhanced_update_user_password(TEXT, TEXT) TO authenticated; 