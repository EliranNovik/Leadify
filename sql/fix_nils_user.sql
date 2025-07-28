-- Function to fix a specific user's auth_id mismatch
CREATE OR REPLACE FUNCTION fix_user_auth_id(user_email TEXT)
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
    
    -- Get existing user in custom table
    SELECT * INTO existing_user FROM users WHERE email = user_email;
    
    IF existing_user IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in custom users table');
    END IF;
    
    -- Update the auth_id to match auth.users
    UPDATE users SET
        auth_id = auth_user_record.id,
        full_name = COALESCE(auth_user_record.raw_user_meta_data->>'full_name', split_part(auth_user_record.email, '@', 1)),
        first_name = auth_user_record.raw_user_meta_data->>'first_name',
        last_name = auth_user_record.raw_user_meta_data->>'last_name',
        updated_at = auth_user_record.updated_at
    WHERE email = user_email;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User auth_id fixed successfully',
        'old_auth_id', existing_user.auth_id,
        'new_auth_id', auth_user_record.id,
        'email', auth_user_record.email
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', 'Error fixing user: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fix_user_auth_id(TEXT) TO authenticated; 