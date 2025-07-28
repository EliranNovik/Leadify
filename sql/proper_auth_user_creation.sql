-- Proper auth user creation that works with Supabase authentication
-- This approach uses Supabase's built-in user management functions

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Function to sync auth users to users table
CREATE OR REPLACE FUNCTION sync_auth_user_to_users()
RETURNS TRIGGER AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    -- Check if user already exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = NEW.email) INTO user_exists;
    
    -- Only sync if user doesn't exist in users table
    IF NOT user_exists THEN
        INSERT INTO users (
            id,
            email,
            full_name,
            role,
            is_active,
            is_staff,
            is_superuser,
            created_at,
            updated_at
        ) VALUES (
            NEW.id,
            NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
            'user',
            true,
            false,
            false,
            NEW.created_at,
            NEW.updated_at
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to sync auth users to users table
DROP TRIGGER IF EXISTS sync_auth_user_to_users_trigger ON auth.users;
CREATE TRIGGER sync_auth_user_to_users_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_auth_user_to_users();

-- Function to create user properly in auth system
CREATE OR REPLACE FUNCTION create_user_properly(
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
        'message', 'User created successfully in auth system',
        'user_id', auth_user_id,
        'email', user_email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error creating user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user password
CREATE OR REPLACE FUNCTION update_user_password_simple(
    user_email TEXT,
    new_password TEXT
)
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
    
    -- Hash the password
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
        'email', user_email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error updating password: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_auth_user_to_users() TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_properly(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_password_simple(TEXT, TEXT) TO authenticated; 