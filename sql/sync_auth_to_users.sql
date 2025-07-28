-- Function to sync a user from auth.users to the custom users table
CREATE OR REPLACE FUNCTION sync_auth_user_to_custom_table(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    user_exists BOOLEAN;
BEGIN
    -- Get user from auth.users
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Check if user already exists in custom users table
    SELECT EXISTS(SELECT 1 FROM users WHERE email = user_email) INTO user_exists;
    
    IF user_exists THEN
        -- Update existing user
        UPDATE users 
        SET 
            auth_id = auth_user_record.id,
            full_name = COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(user_email, '@', 1)),
            role = 'user',
            is_active = true,
            updated_at = NOW()
        WHERE email = user_email;
        
        RETURN json_build_object(
            'success', true,
            'message', 'User updated in custom table',
            'email', user_email,
            'auth_id', auth_user_record.id
        );
    ELSE
        -- Insert new user
        INSERT INTO users (
            id,
            auth_id,
            email,
            full_name,
            role,
            is_active,
            is_staff,
            is_superuser,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            auth_user_record.id,
            user_email,
            COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(user_email, '@', 1)),
            'user',
            true,
            false,
            false,
            NOW(),
            NOW()
        );
        
        RETURN json_build_object(
            'success', true,
            'message', 'User synced to custom table',
            'email', user_email,
            'auth_id', auth_user_record.id
        );
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error syncing user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync all auth users to custom table
CREATE OR REPLACE FUNCTION sync_all_auth_users()
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    synced_count INTEGER := 0;
    total_count INTEGER := 0;
BEGIN
    -- Count total auth users
    SELECT COUNT(*) INTO total_count FROM auth.users;
    
    -- Loop through all auth users
    FOR auth_user_record IN SELECT * FROM auth.users LOOP
        PERFORM sync_auth_user_to_custom_table(auth_user_record.email);
        synced_count := synced_count + 1;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Synced ' || synced_count || ' users to custom table',
        'synced_count', synced_count,
        'total_count', total_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error syncing users: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_auth_user_to_custom_table(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_all_auth_users() TO authenticated; 