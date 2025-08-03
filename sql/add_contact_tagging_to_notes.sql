-- Add contact tagging functionality to notes

-- Add contact_id column to lead_notes table
ALTER TABLE lead_notes 
ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- Create index for contact_id for better performance
CREATE INDEX IF NOT EXISTS idx_lead_notes_contact_id ON lead_notes(contact_id);

-- Update the create_lead_note function to include contact_id
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
BEGIN
  -- Get current user's full name
  SELECT get_user_full_name_for_notes(auth.uid()) INTO v_user_full_name;
  
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
    auth.uid(),
    v_user_full_name,
    p_is_important,
    p_is_private,
    p_tags,
    p_contact_id
  ) RETURNING id INTO v_note_id;
  
  RETURN v_note_id;
END;
$$ LANGUAGE plpgsql;

-- Update the update_lead_note function to include contact_id
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
BEGIN
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
  WHERE id = p_note_id AND created_by = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql; 