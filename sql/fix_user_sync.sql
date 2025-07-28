-- Function to sync or update a single auth user to custom table
CREATE OR REPLACE FUNCTION sync_or_update_auth_user(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    existing_user RECORD;
BEGIN
    -- Get auth user
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users');
    END IF;
    
    -- Check if user already exists in custom table
    SELECT * INTO existing_user FROM users WHERE email = user_email;
    
    IF existing_user IS NOT NULL THEN
        -- User exists, update their data
        UPDATE users SET
            auth_id = auth_user_record.id,
            full_name = COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(auth_user_record.email, '@', 1)),
            first_name = auth_user_record.raw_user_meta_data->>'first_name',
            last_name = auth_user_record.raw_user_meta_data->>'last_name',
            updated_at = auth_user_record.updated_at
        WHERE email = user_email;
        
        RETURN json_build_object(
            'success', true,
            'message', 'User updated successfully',
            'user_id', auth_user_record.id,
            'email', auth_user_record.email,
            'action', 'updated'
        );
    ELSE
        -- User doesn't exist, insert new user
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
            'email', auth_user_record.email,
            'action', 'created'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error syncing user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_or_update_auth_user(TEXT) TO authenticated; 