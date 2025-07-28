-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function to automatically sync auth users to custom users table
CREATE OR REPLACE FUNCTION sync_auth_user_to_users_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Only sync on INSERT (new user creation)
    IF TG_OP = 'INSERT' THEN
        -- Check if user already exists in custom table
        IF NOT EXISTS (SELECT 1 FROM users WHERE email = NEW.email) THEN
            -- Insert user into custom users table
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
                NEW.id,
                NEW.email,
                COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
                NEW.raw_user_meta_data->>'first_name',
                NEW.raw_user_meta_data->>'last_name',
                'user',
                true,
                false,
                false,
                NEW.created_at,
                NEW.updated_at
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users table
DROP TRIGGER IF EXISTS auth_users_sync_trigger ON auth.users;
CREATE TRIGGER auth_users_sync_trigger
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_auth_user_to_users_trigger();

-- Function to sync existing auth users to custom table
CREATE OR REPLACE FUNCTION sync_existing_auth_users()
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
            -- Insert user into custom users table
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
    RETURN json_build_object(
        'success', false,
        'message', 'Error syncing users: ' || SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sync_auth_user_to_users_trigger() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_existing_auth_users() TO authenticated;

-- Function to check sync status
CREATE OR REPLACE FUNCTION check_sync_status()
RETURNS JSON AS $$
DECLARE
    auth_count INTEGER;
    custom_count INTEGER;
    synced_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO auth_count FROM auth.users;
    SELECT COUNT(*) INTO custom_count FROM users;
    SELECT COUNT(*) INTO synced_count FROM users WHERE auth_id IS NOT NULL;
    
    RETURN json_build_object(
        'success', true,
        'auth_users_count', auth_count,
        'custom_users_count', custom_count,
        'synced_users_count', synced_count,
        'unsynced_auth_users', auth_count - synced_count,
        'orphaned_custom_users', custom_count - synced_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_sync_status() TO authenticated; 