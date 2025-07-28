-- Debug function to check user sync status and fix issues
CREATE OR REPLACE FUNCTION debug_user_sync(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    users_table_record RECORD;
    auth_exists BOOLEAN;
    users_exists BOOLEAN;
BEGIN
    -- Check if user exists in auth.users
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO auth_exists;
    
    IF NOT auth_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users table');
    END IF;
    
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    -- Check if user exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO users_exists;
    
    IF users_exists THEN
        SELECT * INTO users_table_record FROM users WHERE email = user_email;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'auth_user', json_build_object(
            'id', auth_user_record.id,
            'email', auth_user_record.email,
            'role', auth_user_record.role,
            'email_confirmed_at', auth_user_record.email_confirmed_at,
            'confirmed_at', auth_user_record.confirmed_at,
            'has_password', auth_user_record.encrypted_password IS NOT NULL,
            'created_at', auth_user_record.created_at
        ),
        'users_table', CASE 
            WHEN users_exists THEN json_build_object(
                'id', users_table_record.id,
                'email', users_table_record.email,
                'full_name', users_table_record.full_name,
                'role', users_table_record.role,
                'is_active', users_table_record.is_active,
                'created_at', users_table_record.created_at
            )
            ELSE json_build_object('exists', false)
        END,
        'sync_status', CASE 
            WHEN users_exists THEN 'synced'
            ELSE 'not_synced'
        END
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error checking user sync: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to manually sync a user to users table
CREATE OR REPLACE FUNCTION manual_sync_user_to_users(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    user_exists BOOLEAN;
BEGIN
    -- Check if user exists in auth.users
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = user_email) INTO user_exists;
    
    IF NOT user_exists THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users table');
    END IF;
    
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    -- Check if already exists in users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF user_exists THEN
        RETURN json_build_object('success', true, 'message', 'User already exists in users table');
    END IF;
    
    -- Insert into users table
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
        auth_user_record.id,
        auth_user_record.email,
        COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(auth_user_record.email, '@', 1)),
        'user',
        true,
        false,
        false,
        auth_user_record.created_at,
        auth_user_record.updated_at
    );
    
    RETURN json_build_object(
        'success', true,
        'message', 'User manually synced to users table',
        'user_id', auth_user_record.id,
        'email', auth_user_record.email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error syncing user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to test authentication directly
CREATE OR REPLACE FUNCTION test_user_authentication(user_email TEXT, user_password TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    password_matches BOOLEAN;
BEGIN
    -- Get auth user details
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found');
    END IF;
    
    -- Test password
    SELECT (auth_user_record.encrypted_password = crypt(user_password, auth_user_record.encrypted_password)) INTO password_matches;
    
    RETURN json_build_object(
        'success', true,
        'user_found', true,
        'password_matches', password_matches,
        'email_confirmed', auth_user_record.email_confirmed_at IS NOT NULL,
        'user_confirmed', auth_user_record.confirmed_at IS NOT NULL,
        'can_login', password_matches AND auth_user_record.email_confirmed_at IS NOT NULL,
        'user_id', auth_user_record.id,
        'email', auth_user_record.email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error testing authentication: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION debug_user_sync(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION manual_sync_user_to_users(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION test_user_authentication(TEXT, TEXT) TO authenticated; 