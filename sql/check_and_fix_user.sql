-- Function to check and fix user authentication status
CREATE OR REPLACE FUNCTION check_and_fix_user_auth(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    updated_count INTEGER;
BEGIN
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Update user to ensure all required fields are set
    UPDATE auth.users 
    SET 
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        confirmed_at = COALESCE(confirmed_at, NOW()),
        raw_app_meta_data = COALESCE(raw_app_meta_data, '{"provider": "email", "providers": ["email"]}'::jsonb),
        updated_at = NOW()
    WHERE email = user_email;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User authentication status checked and fixed',
        'email', user_email,
        'user_id', auth_user_record.id,
        'email_confirmed', auth_user_record.email_confirmed_at IS NOT NULL,
        'user_confirmed', auth_user_record.confirmed_at IS NOT NULL,
        'has_password', auth_user_record.encrypted_password IS NOT NULL,
        'provider_set', CASE 
            WHEN auth_user_record.raw_app_meta_data IS NOT NULL AND auth_user_record.raw_app_meta_data ? 'provider' THEN
                auth_user_record.raw_app_meta_data->>'provider'
            ELSE
                'not_set'
        END,
        'updated_count', updated_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error checking user auth: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_and_fix_user_auth(TEXT) TO authenticated; 