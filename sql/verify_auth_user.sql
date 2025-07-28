-- Function to verify auth user creation and test authentication
CREATE OR REPLACE FUNCTION verify_auth_user(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    user_exists BOOLEAN;
    password_hash TEXT;
BEGIN
    -- Check if user exists in auth.users
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users table');
    END IF;
    
    -- Get user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    -- Check if password is properly set
    IF auth_user_record.encrypted_password IS NULL OR auth_user_record.encrypted_password = '' THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'User exists but has no password set',
            'user_id', auth_user_record.id,
            'email', auth_user_record.email,
            'role', auth_user_record.role
        );
    END IF;
    
    -- Check if email is confirmed
    IF auth_user_record.email_confirmed_at IS NULL THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'User exists but email is not confirmed',
            'user_id', auth_user_record.id,
            'email', auth_user_record.email,
            'role', auth_user_record.role,
            'has_password', true
        );
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User exists and appears to be properly configured',
        'user_id', auth_user_record.id,
        'email', auth_user_record.email,
        'role', auth_user_record.role,
        'has_password', true,
        'email_confirmed', true,
        'created_at', auth_user_record.created_at
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error checking user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to fix auth user for login
CREATE OR REPLACE FUNCTION fix_auth_user_for_login(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    -- Check if user exists
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found');
    END IF;
    
    -- Update user to ensure it can login
    UPDATE auth.users 
    SET 
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        confirmed_at = COALESCE(confirmed_at, NOW()),
        updated_at = NOW()
    WHERE email = user_email;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User updated for login access',
        'email', user_email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION verify_auth_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fix_auth_user_for_login(TEXT) TO authenticated; 