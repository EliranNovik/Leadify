-- Fix the auth_id column specifically
-- This function updates the auth_id column to match the auth.users table

CREATE OR REPLACE FUNCTION fix_auth_id_column(user_email TEXT)
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
    
    -- Update the auth_id column with the auth user's ID
    UPDATE users 
    SET 
        auth_id = auth_user_record.id,
        updated_at = NOW()
    WHERE email = user_email;
    
    RETURN json_build_object(
        'success', true,
        'message', 'User auth_id column fixed successfully',
        'old_auth_id', user_record.auth_id,
        'new_auth_id', auth_user_record.id,
        'email', user_email
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing auth_id column: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to fix all auth_id columns
CREATE OR REPLACE FUNCTION fix_all_auth_id_columns()
RETURNS JSON AS $$
DECLARE
    user_record RECORD;
    auth_user_record RECORD;
    fixed_count INTEGER := 0;
    total_count INTEGER := 0;
BEGIN
    -- Count total users with null auth_id
    SELECT COUNT(*) INTO total_count FROM users WHERE auth_id IS NULL;
    
    -- Loop through users with null auth_id
    FOR user_record IN SELECT * FROM users WHERE auth_id IS NULL LOOP
        -- Find corresponding auth user
        SELECT * INTO auth_user_record FROM auth.users WHERE email = user_record.email;
        
        IF auth_user_record IS NOT NULL THEN
            -- Update the auth_id column
            UPDATE users 
            SET 
                auth_id = auth_user_record.id,
                updated_at = NOW()
            WHERE email = user_record.email;
            
            fixed_count := fixed_count + 1;
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Fixed ' || fixed_count || ' out of ' || total_count || ' users with null auth_id',
        'fixed_count', fixed_count,
        'total_count', total_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error fixing auth_id columns: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync all auth users to auth_id column
CREATE OR REPLACE FUNCTION sync_all_auth_ids()
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
        -- Check if user exists in users table
        SELECT EXISTS(SELECT 1 FROM users WHERE email = auth_user_record.email) INTO user_exists;
        
        IF user_exists THEN
            -- Update existing user's auth_id
            UPDATE users 
            SET 
                auth_id = auth_user_record.id,
                updated_at = NOW()
            WHERE email = auth_user_record.email AND (auth_id IS NULL OR auth_id != auth_user_record.id);
            
            IF FOUND THEN
                synced_count := synced_count + 1;
            END IF;
        ELSE
            -- Insert new user with auth_id
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
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Synced ' || synced_count || ' out of ' || total_count || ' auth users to auth_id column',
        'synced_count', synced_count,
        'total_count', total_count
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'message', 'Error syncing auth_ids: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fix_auth_id_column(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fix_all_auth_id_columns() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_all_auth_ids() TO authenticated; 