-- Function to sync current authenticated user to users table
-- This helps ensure the current user exists in the users table for tracking changes

CREATE OR REPLACE FUNCTION sync_current_user_to_users()
RETURNS void AS $$
DECLARE
    current_user_id UUID;
    current_user_email TEXT;
    current_user_full_name TEXT;
BEGIN
    -- Get current user info from auth context
    current_user_id := auth.uid();
    current_user_email := auth.jwt() ->> 'email';
    
    -- Try to get full name from auth metadata
    current_user_full_name := COALESCE(
        auth.jwt() ->> 'user_metadata' ->> 'full_name',
        auth.jwt() ->> 'user_metadata' ->> 'name',
        split_part(current_user_email, '@', 1)  -- Use email prefix as fallback
    );
    
    -- Insert user if they don't exist
    INSERT INTO users (id, email, full_name, role, is_active, is_staff, is_superuser, created_at, updated_at)
    VALUES (
        current_user_id,
        current_user_email,
        current_user_full_name,
        'admin',  -- Default role for authenticated users
        true,     -- Active by default
        true,     -- Staff access by default
        false,    -- Not superuser by default
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, users.full_name),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION sync_current_user_to_users() TO authenticated;

-- Create a trigger to automatically sync users on login (optional)
-- This would require setting up a webhook or using Supabase Auth hooks 