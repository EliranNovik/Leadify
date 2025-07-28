-- Fix auth user provider information and ensure proper authentication setup
CREATE OR REPLACE FUNCTION fix_auth_user_provider(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    updated_count INTEGER;
BEGIN
    -- Get current auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Update the user with proper provider information
    UPDATE auth.users 
    SET 
        raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb,
        raw_user_meta_data = CASE 
            WHEN auth_user_record.raw_user_meta_data IS NULL OR auth_user_record.raw_user_meta_data = '{}'::jsonb THEN
                json_build_object('full_name', COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(user_email, '@', 1)))::jsonb
            ELSE
                auth_user_record.raw_user_meta_data
        END,
        updated_at = NOW()
    WHERE email = user_email;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    IF updated_count > 0 THEN
        RETURN json_build_object(
            'success', true,
            'message', 'User provider information fixed successfully',
            'email', user_email,
            'provider_added', 'email',
            'user_id', auth_user_record.id
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'message', 'No changes made to user provider information',
            'email', user_email
        );
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing user provider: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to recreate auth user properly
CREATE OR REPLACE FUNCTION recreate_auth_user_properly(
    user_email TEXT,
    user_password TEXT,
    user_full_name TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    user_exists BOOLEAN;
    auth_user_id UUID;
    old_user_id UUID;
BEGIN
    -- Check if user already exists
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF user_exists THEN
        -- Get the old user ID
        SELECT id INTO old_user_id FROM auth.users WHERE email = user_email;
        
        -- Delete the old user
        DELETE FROM auth.users WHERE email = user_email;
        
        -- Also delete from users table if exists
        DELETE FROM users WHERE email = user_email;
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
        COALESCE(old_user_id, gen_random_uuid()),
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
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        CASE 
            WHEN user_full_name IS NOT NULL THEN 
                json_build_object('full_name', user_full_name)::jsonb
            ELSE 
                json_build_object('full_name', split_part(user_email, '@', 1))::jsonb
        END,
        false,
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
        'message', 'User recreated successfully in auth system',
        'user_id', auth_user_id,
        'email', user_email,
        'password_set', true,
        'provider_set', 'email'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error recreating user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check auth user status
CREATE OR REPLACE FUNCTION check_auth_user_status(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
BEGIN
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'user_found', true,
        'user_id', auth_user_record.id,
        'email', auth_user_record.email,
        'role', auth_user_record.role,
        'email_confirmed', auth_user_record.email_confirmed_at IS NOT NULL,
        'user_confirmed', auth_user_record.confirmed_at IS NOT NULL,
        'has_password', auth_user_record.encrypted_password IS NOT NULL,
        'password_length', CASE WHEN auth_user_record.encrypted_password IS NOT NULL THEN length(auth_user_record.encrypted_password) ELSE 0 END,
        'raw_app_meta_data', auth_user_record.raw_app_meta_data,
        'raw_user_meta_data', auth_user_record.raw_user_meta_data,
        'providers', CASE 
            WHEN auth_user_record.raw_app_meta_data IS NOT NULL AND auth_user_record.raw_app_meta_data ? 'providers' THEN
                auth_user_record.raw_app_meta_data->'providers'
            ELSE
                '[]'::json
        END,
        'provider', CASE 
            WHEN auth_user_record.raw_app_meta_data IS NOT NULL AND auth_user_record.raw_app_meta_data ? 'provider' THEN
                auth_user_record.raw_app_meta_data->>'provider'
            ELSE
                NULL
        END,
        'created_at', auth_user_record.created_at,
        'updated_at', auth_user_record.updated_at
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error checking user status: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fix_auth_user_provider(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION recreate_auth_user_properly(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_auth_user_status(TEXT) TO authenticated; 