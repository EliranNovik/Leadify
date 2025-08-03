-- Create lead note function that accepts user information as parameters

CREATE OR REPLACE FUNCTION create_lead_note_with_user(
  p_lead_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_note_type TEXT DEFAULT 'general',
  p_is_important BOOLEAN DEFAULT FALSE,
  p_is_private BOOLEAN DEFAULT FALSE,
  p_tags TEXT[] DEFAULT '{}',
  p_contact_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_note_id UUID;
  v_user_full_name TEXT;
  v_user_email TEXT;
  v_final_user_id UUID;
BEGIN
  -- Determine user ID
  v_final_user_id := COALESCE(p_user_id, auth.uid(), gen_random_uuid());
  
  -- Determine user name
  IF p_user_name IS NOT NULL AND p_user_name != '' THEN
    v_user_full_name := p_user_name;
  ELSE
    -- Try to get user info from users table
    SELECT full_name, email INTO v_user_full_name, v_user_email
    FROM users
    WHERE id = v_final_user_id;
    
    -- If not found in users table, try auth.users
    IF v_user_full_name IS NULL OR v_user_full_name = '' THEN
      SELECT email INTO v_user_email
      FROM auth.users
      WHERE id = v_final_user_id;
      
      -- Use email as fallback
      IF v_user_email IS NOT NULL THEN
        v_user_full_name := v_user_email;
      ELSE
        v_user_full_name := 'Unknown User';
      END IF;
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
    v_final_user_id,
    v_user_full_name,
    p_is_important,
    p_is_private,
    p_tags,
    p_contact_id
  ) RETURNING id INTO v_note_id;
  
  RETURN v_note_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_lead_note_with_user(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT[], UUID, UUID, TEXT) TO authenticated; 