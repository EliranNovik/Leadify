-- Ensure current user exists in users table with proper full_name

-- Function to create or update user in users table
CREATE OR REPLACE FUNCTION ensure_user_exists()
RETURNS TEXT AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
  v_user_full_name TEXT;
  v_existing_full_name TEXT;
BEGIN
  -- Get current user info
  v_user_id := auth.uid();
  
  -- Get email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;
  
  -- Check if user exists in users table
  SELECT full_name INTO v_existing_full_name
  FROM users
  WHERE id = v_user_id;
  
  -- If user doesn't exist in users table, create them
  IF v_existing_full_name IS NULL THEN
    -- Extract name from email (everything before @)
    v_user_full_name := COALESCE(
      SPLIT_PART(v_user_email, '@', 1),
      'Unknown User'
    );
    
    -- Insert user into users table
    INSERT INTO users (id, email, full_name, created_at, updated_at)
    VALUES (v_user_id, v_user_email, v_user_full_name, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      updated_at = NOW();
    
    RETURN v_user_full_name;
  ELSE
    -- If user exists but full_name is empty, update it
    IF v_existing_full_name = '' OR v_existing_full_name IS NULL THEN
      v_user_full_name := COALESCE(
        SPLIT_PART(v_user_email, '@', 1),
        'Unknown User'
      );
      
      UPDATE users 
      SET full_name = v_user_full_name, updated_at = NOW()
      WHERE id = v_user_id;
      
      RETURN v_user_full_name;
    ELSE
      RETURN v_existing_full_name;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Call the function to ensure current user exists
SELECT ensure_user_exists(); 