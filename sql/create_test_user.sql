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
    
    -- Create user in auth system with minimal required fields
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
        raw_app_meta_data,
        raw_user_meta_data
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
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        CASE 
            WHEN user_full_name IS NOT NULL THEN 
                json_build_object('full_name', user_full_name)::jsonb
            ELSE 
                json_build_object('full_name', split_part(user_email, '@', 1))::jsonb
        END
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
GRANT EXECUTE ON FUNCTION create_test_user_with_real_email(TEXT, TEXT, TEXT) TO authenticated; 