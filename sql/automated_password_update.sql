-- Automated password update with auth sync
-- This function updates passwords and automatically creates auth users

CREATE OR REPLACE FUNCTION update_user_password_automated(
    user_email TEXT,
    new_password TEXT
)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
    user_id UUID;
    user_full_name TEXT;
    auth_exists BOOLEAN;
    auth_created BOOLEAN;
BEGIN
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in users table');
    END IF;
    
    -- Get user details
    SELECT id, full_name INTO user_id, user_full_name FROM users WHERE email = user_email;
    
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
    
    -- If user doesn't exist in auth, create them
    IF NOT auth_exists THEN
        SELECT create_auth_user(user_email, hashed_password, user_full_name, user_id) INTO auth_created;
        
        IF auth_created THEN
            RETURN json_build_object(
                'success', true, 
                'message', 'Password updated and auth user created successfully!',
                'auth_status', 'created',
                'user_id', user_id
            );
        ELSE
            RETURN json_build_object(
                'success', true, 
                'message', 'Password updated successfully, but auth user creation failed.',
                'auth_status', 'failed',
                'user_id', user_id
            );
        END IF;
    ELSE
        -- User exists in auth, just update their password
        UPDATE auth.users 
        SET 
            encrypted_password = hashed_password,
            updated_at = NOW()
        WHERE email = user_email;
        
        RETURN json_build_object(
            'success', true, 
            'message', 'Password updated successfully!',
            'auth_status', 'updated',
            'user_id', user_id
        );
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_user_password_automated(TEXT, TEXT) TO authenticated; 