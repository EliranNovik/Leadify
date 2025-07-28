-- Fix users with null auth IDs by syncing them properly
CREATE OR REPLACE FUNCTION fix_null_auth_ids()
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    auth_user_record RECORD;
    fixed_count INTEGER := 0;
    total_count INTEGER := 0;
BEGIN
    -- Count total users with null IDs
    SELECT COUNT(*) INTO total_count FROM users WHERE id IS NULL;
    
    -- Loop through users with null IDs
    FOR user_record IN SELECT * FROM users WHERE id IS NULL LOOP
        -- Find corresponding auth user
        SELECT * INTO auth_user_record FROM auth.users WHERE email = user_record.email;
        
        IF auth_user_record IS NOT NULL THEN
            -- Update the user with the correct auth ID
            UPDATE users 
            SET 
                id = auth_user_record.id,
                updated_at = NOW()
            WHERE email = user_record.email;
            
            fixed_count := fixed_count + 1;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Fixed ' || fixed_count || ' out of ' || total_count || ' users with null auth IDs',
        'fixed_count', fixed_count,
        'total_count', total_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing null auth IDs: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to fix a specific user's auth ID
CREATE OR REPLACE FUNCTION fix_user_auth_id(user_email TEXT)
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    auth_user_record RECORD;
BEGIN
    -- Get user from users table
    SELECT * INTO user_record FROM users WHERE email = user_email;
    
    IF user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in users table');
    END IF;
    
    -- Get corresponding auth user
    SELECT * INTO auth_user_record FROM auth.users WHERE email = user_email;
    
    IF auth_user_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'User not found in auth.users table');
    END IF;
    
    -- Update the user with the correct auth ID
    UPDATE users 
    SET 
        id = auth_user_record.id,
        updated_at = NOW()
    WHERE email = user_email;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User auth ID fixed successfully',
        'old_id', user_record.id,
        'new_id', auth_user_record.id,
        'email', user_email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing user auth ID: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync all auth users to users table
CREATE OR REPLACE FUNCTION sync_all_auth_users()
RETURNS JSON AS $$
DECLARE
    auth_user_record RECORD;
    user_exists BOOLEAN;
    synced_count INTEGER := 0;
    total_count INTEGER := 0;
BEGIN
    -- Count total auth users
    SELECT COUNT(*) INTO total_count FROM auth.users;
    
    -- Loop through all auth users
    FOR auth_user_record IN SELECT * FROM auth.users LOOP
        -- Check if user already exists in users table
        SELECT EXISTS(SELECT 1 FROM users WHERE email = auth_user_record.email) INTO user_exists;
        
        IF NOT user_exists THEN
            -- Insert new user
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
            
            synced_count := synced_count + 1;
        ELSE
            -- Update existing user with correct auth ID
            UPDATE users 
            SET 
                id = auth_user_record.id,
                updated_at = NOW()
            WHERE email = auth_user_record.email AND (id IS NULL OR id != auth_user_record.id);
            
            IF FOUND THEN
                synced_count := synced_count + 1;
            END IF;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Synced ' || synced_count || ' out of ' || total_count || ' auth users',
        'synced_count', synced_count,
        'total_count', total_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error syncing auth users: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fix_null_auth_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION fix_user_auth_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_all_auth_users() TO authenticated; 