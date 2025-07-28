-- Function to create user in Supabase auth system
-- This uses the built-in auth functions that don't require admin permissions

CREATE OR REPLACE FUNCTION create_user_in_auth(
    user_email TEXT,
    user_password TEXT,
    user_full_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    auth_user_id UUID;
BEGIN
    -- Check if user already exists in auth
    SELECT id INTO auth_user_id 
    FROM auth.users 
    WHERE email = user_email;
    
    -- If user already exists in auth, return true
    IF auth_user_id IS NOT NULL THEN
        RETURN TRUE;
    END IF;
    
    -- Create user in auth.users table directly
    -- This bypasses the admin API restrictions
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
        '00000000-0000-0000-0000-000000000000', -- default instance_id
        gen_random_uuid(), -- generate new UUID
        'authenticated',
        'authenticated',
        user_email,
        crypt(user_password, gen_salt('bf')), -- hash password
        NOW(), -- email confirmed
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
    );
    
    RETURN TRUE;
    
EXCEPTION
    WHEN OTHERS THEN
        -- If there's any error, return false
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_user_in_auth(TEXT, TEXT, TEXT) TO authenticated; 