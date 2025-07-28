-- Automated auth user sync system
-- This creates triggers and functions to automatically sync users to auth system

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add password_hash column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Function to create user in auth system
CREATE OR REPLACE FUNCTION create_auth_user(
    user_email TEXT,
    user_password_hash TEXT,
    user_full_name TEXT DEFAULT NULL,
    user_id UUID DEFAULT NULL
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
    
    -- Use provided user_id or generate new one
    IF user_id IS NULL THEN
        user_id := gen_random_uuid();
    END IF;
    
    -- Create user in auth.users table
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
        user_id,
        'authenticated',
        'authenticated',
        user_email,
        user_password_hash,
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
    );
    
    RETURN TRUE;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error but don't fail the operation
        RAISE NOTICE 'Failed to create auth user for %: %', user_email, SQLERRM;
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync user to auth when inserted/updated
CREATE OR REPLACE FUNCTION sync_user_to_auth()
RETURNS TRIGGER AS $$
BEGIN
    -- Only sync if there's a password_hash
    IF NEW.password_hash IS NOT NULL THEN
        -- Try to create user in auth system
        PERFORM create_auth_user(
            NEW.email,
            NEW.password_hash,
            NEW.full_name,
            NEW.id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to sync users to auth on insert
DROP TRIGGER IF EXISTS sync_user_to_auth_insert_trigger ON users;
CREATE TRIGGER sync_user_to_auth_insert_trigger
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_to_auth();

-- Create trigger to sync users to auth on update
DROP TRIGGER IF EXISTS sync_user_to_auth_update_trigger ON users;
CREATE TRIGGER sync_user_to_auth_update_trigger
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_to_auth();

-- Function to bulk sync existing users to auth
CREATE OR REPLACE FUNCTION bulk_sync_users_to_auth()
RETURNS TABLE(email TEXT, success BOOLEAN, message TEXT) AS $$
DECLARE
    user_record RECORD;
    sync_success BOOLEAN;
BEGIN
    -- Loop through all users that have password_hash but don't exist in auth
    FOR user_record IN 
        SELECT u.email, u.password_hash, u.full_name, u.id
        FROM users u
        WHERE u.password_hash IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM auth.users au WHERE au.email = u.email
        )
    LOOP
        -- Try to create auth user
        SELECT create_auth_user(
            user_record.email,
            user_record.password_hash,
            user_record.full_name,
            user_record.id
        ) INTO sync_success;
        
        -- Return result
        email := user_record.email;
        success := sync_success;
        message := CASE 
            WHEN sync_success THEN 'Auth user created successfully'
            ELSE 'Failed to create auth user'
        END;
        
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_auth_user(TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_user_to_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_sync_users_to_auth() TO authenticated; 