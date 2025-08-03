-- Fix user full name resolution for notes

-- Update the get_user_full_name_for_notes function to be more robust
CREATE OR REPLACE FUNCTION get_user_full_name_for_notes(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_full_name TEXT;
  user_email TEXT;
BEGIN
  -- First try to get full_name from users table
  SELECT full_name, email INTO user_full_name, user_email
  FROM users
  WHERE id = p_user_id;
  
  -- If full_name is not found, try to get it from auth.users
  IF user_full_name IS NULL OR user_full_name = '' THEN
    SELECT email INTO user_email
    FROM auth.users
    WHERE id = p_user_id;
    
    -- Use email as fallback
    IF user_email IS NOT NULL THEN
      user_full_name := user_email;
    ELSE
      user_full_name := 'Unknown User';
    END IF;
  END IF;
  
  RETURN user_full_name;
END;
$$ LANGUAGE plpgsql;

-- Update the create_lead_note function to handle user name resolution better
CREATE OR REPLACE FUNCTION create_lead_note(
  p_lead_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_note_type TEXT DEFAULT 'general',
  p_is_important BOOLEAN DEFAULT FALSE,
  p_is_private BOOLEAN DEFAULT FALSE,
  p_tags TEXT[] DEFAULT '{}',
  p_contact_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_note_id UUID;
  v_user_full_name TEXT;
  v_user_email TEXT;
  v_user_id UUID;
BEGIN
  -- Get current user ID safely
  v_user_id := auth.uid();
  
  -- If no authenticated user, use a default
  IF v_user_id IS NULL THEN
    v_user_full_name := 'System User';
  ELSE
    -- Get current user's email first
    SELECT email INTO v_user_email
    FROM auth.users
    WHERE id = v_user_id;
    
    -- Try to get full name from users table
    SELECT full_name INTO v_user_full_name
    FROM users
    WHERE id = v_user_id;
    
    -- If full_name is not found, use email
    IF v_user_full_name IS NULL OR v_user_full_name = '' THEN
      v_user_full_name := COALESCE(v_user_email, 'Unknown User');
    END IF;
  END IF;
  
  -- Insert the note
  INSERT INTO lead_notes (
    lead_id,
    title,
    content,
    note_type,
    created_by,
    created_by_name,
    is_important,
    is_private,
    tags,
    contact_id
  ) VALUES (
    p_lead_id,
    p_title,
    p_content,
    p_note_type,
    COALESCE(v_user_id, gen_random_uuid()),
    v_user_full_name,
    p_is_important,
    p_is_private,
    p_tags,
    p_contact_id
  ) RETURNING id INTO v_note_id;
  
  RETURN v_note_id;
END;
$$ LANGUAGE plpgsql;

-- Also update the update_lead_note function to maintain consistency
CREATE OR REPLACE FUNCTION update_lead_note(
  p_note_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_note_type TEXT,
  p_is_important BOOLEAN,
  p_is_private BOOLEAN,
  p_tags TEXT[],
  p_contact_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get current user ID safely
  v_user_id := auth.uid();
  
  -- If no authenticated user, allow update anyway (for system operations)
  IF v_user_id IS NULL THEN
    UPDATE lead_notes 
    SET 
      title = p_title,
      content = p_content,
      note_type = p_note_type,
      is_important = p_is_important,
      is_private = p_is_private,
      tags = p_tags,
      contact_id = p_contact_id,
      updated_at = NOW()
    WHERE id = p_note_id;
  ELSE
    UPDATE lead_notes 
    SET 
      title = p_title,
      content = p_content,
      note_type = p_note_type,
      is_important = p_is_important,
      is_private = p_is_private,
      tags = p_tags,
      contact_id = p_contact_id,
      updated_at = NOW()
    WHERE id = p_note_id AND created_by = v_user_id;
  END IF;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql; 