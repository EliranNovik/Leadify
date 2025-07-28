-- Function to manually sync a single auth user to custom table
CREATE OR REPLACE FUNCTION sync_single_auth_user(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
BEGIN
    -- Get auth user
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Check if user already exists in custom table
    IF EXISTS (SELECT 1 FROM users WHERE email = user_email) THEN
        RETURN json_build_object('success', false, 'message', 'User already exists in custom table');
    END IF;
    
    -- Insert user into custom table
    INSERT INTO users (
        id,
        auth_id,
        email,
        full_name,
        first_name,
        last_name,
        role,
        is_active,
        is_staff,
        is_superuser,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        auth_user_record.id,
        auth_user_record.email,
        COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(auth_user_record.email, '@', 1)),
        auth_user_record.raw_user_meta_data->>'first_name',
        auth_user_record.raw_user_meta_data->>'last_name',
        'user',
        true,
        false,
        false,
        auth_user_record.created_at,
        auth_user_record.updated_at
    );
    
    RETURN json_build_object(
        'success', true,
        'message', 'User synced successfully',
        'user_id', auth_user_record.id,
        'email', auth_user_record.email
    );
EXCEPTION WHEN OTHERS THEN
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
    SELECT COUNT(*) INTO total_count FROM auth.users;
    
    FOR auth_user_record IN SELECT * FROM auth.users LOOP
        -- Check if user already exists in custom table
        IF NOT EXISTS (SELECT 1 FROM users WHERE email = auth_user_record.email) THEN
            -- Insert user into custom table
            INSERT INTO users (
                id,
                auth_id,
                email,
                full_name,
                first_name,
                last_name,
                role,
                is_active,
                is_staff,
                is_superuser,
                created_at,
                updated_at
            ) VALUES (
                gen_random_uuid(),
                auth_user_record.id,
                auth_user_record.email,
                COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(auth_user_record.email, '@', 1)),
                auth_user_record.raw_user_meta_data->>'first_name',
                auth_user_record.raw_user_meta_data->>'last_name',
                'user',
                true,
                false,
                false,
                auth_user_record.created_at,
                auth_user_record.updated_at
            );
            synced_count := synced_count + 1;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Synced ' || synced_count || ' out of ' || total_count || ' auth users to custom table',
        'synced_count', synced_count,
        'total_count', total_count
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error syncing users: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_single_auth_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_all_auth_users() TO authenticated; 