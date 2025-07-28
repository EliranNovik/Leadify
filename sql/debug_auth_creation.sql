-- Debug and fix auth user creation issues
-- This will help identify why the auth user creation is failing

-- First, let's create a debug function to see what's happening
CREATE OR REPLACE FUNCTION debug_auth_creation(
    user_email TEXT
)
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    auth_exists BOOLEAN;
    error_message TEXT;
BEGIN
    -- Get user details from users table
    SELECT * INTO user_record FROM users WHERE email = user_email;
    
    IF user_record IS NULL THEN
        RETURN json_build_object('error', 'User not found in users table');
    END IF;
    
    -- Check if user exists in auth
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO auth_exists;
    
    -- Try to create auth user and catch any errors
    BEGIN
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
            user_record.id,
            'authenticated',
            'authenticated',
            user_email,
            user_record.password_hash,
            NOW(),
            NOW(),
            NOW(),
            '',
            '',
            '',
            '',
            '{"provider": "email", "providers": ["email"]}',
            CASE 
                WHEN user_record.full_name IS NOT NULL THEN 
                    json_build_object('full_name', user_record.full_name)
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
        
        RETURN json_build_object(
            'success', true,
            'message', 'Auth user created successfully',
            'user_id', user_record.id,
            'email', user_email
        );
        
    EXCEPTION
        WHEN OTHERS THEN
            error_message := SQLERRM;
            RETURN json_build_object(
                'success', false,
                'error', error_message,
                'user_id', user_record.id,
                'email', user_email,
                'auth_exists', auth_exists
            );
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION debug_auth_creation(TEXT) TO authenticated; 