-- Test password authentication and fix user issues
CREATE OR REPLACE FUNCTION test_user_password(user_email TEXT, test_password TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    password_matches BOOLEAN;
    test_hash TEXT;
BEGIN
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Test if password matches
    SELECT (auth_user_record.encrypted_password = crypt(test_password, auth_user_record.encrypted_password)) INTO password_matches;
    
    -- Also test with a fresh hash to see if the password is valid
    test_hash := crypt(test_password, gen_salt('bf'));
    
    RETURN json_build_object(
        'success', true,
        'user_found', true,
        'password_matches', password_matches,
        'email_confirmed', auth_user_record.email_confirmed_at IS NOT NULL,
        'user_confirmed', auth_user_record.confirmed_at IS NOT NULL,
        'can_login', password_matches AND auth_user_record.email_confirmed_at IS NOT NULL,
        'user_id', auth_user_record.id,
        'email', auth_user_record.email,
        'encrypted_password_length', length(auth_user_record.encrypted_password),
        'test_hash_length', length(test_hash)
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error testing password: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user password with proper hashing
CREATE OR REPLACE FUNCTION update_user_password_proper(user_email TEXT, new_password TEXT)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    hashed_password TEXT;
BEGIN
    -- Check if user exists in auth
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth system');
    END IF;
    
    -- Hash the password properly
    hashed_password := crypt(new_password, gen_salt('bf'));
    
    -- Update password in auth system
    UPDATE auth.users 
    SET 
        encrypted_password = hashed_password,
        updated_at = NOW()
    WHERE email = user_email;
    
    -- Also update in users table if it exists
    UPDATE users 
    SET 
        password_hash = hashed_password,
        updated_at = NOW()
    WHERE email = user_email;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Password updated successfully',
        'email', user_email,
        'password_hash_length', length(hashed_password)
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error updating password: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a test user with a real-looking email
CREATE OR REPLACE FUNCTION create_test_user_with_real_email(
    user_email TEXT,
    user_password TEXT,
    user_full_name TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    auth_user_id UUID;
BEGIN
    -- Check if user already exists
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User already exists');
    END IF;
    
    -- Create user in auth system with all required fields for login
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        confirmed_at,
        last_sign_in_at,
        phone,
        phone_confirmed_at,
        phone_change,
        phone_change_token,
        email_change_token_current,
        email_change_confirm_status,
        banned_until,
        reauthentication_token,
        reauthentication_sent_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        user_email,
        crypt(user_password, gen_salt('bf')),
        NOW(),
        NOW(),
        NOW(),
        '',
        '',
        '',
        '',
        '{"provider": "email", "providers": ["email"]}',
        CASE 
            WHEN user_full_name IS NOT NULL THEN 
                json_build_object('full_name', user_full_name)
            ELSE 
                '{}'
        END,
        false,
        NOW(),
        NULL,
        NULL,
        NULL,
        '',
        '',
        '',
        0,
        NULL,
        '',
        NULL
    ) RETURNING id INTO auth_user_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Test user created successfully in auth system',
        'user_id', auth_user_id,
        'email', user_email,
        'password_set', true
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error creating test user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION test_user_password(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_password_proper(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_test_user_with_real_email(TEXT, TEXT, TEXT) TO authenticated; 