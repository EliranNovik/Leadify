-- Create notes table for storing multiple notes per lead
CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  note_type VARCHAR(50) DEFAULT 'general', -- general, internal, client, important, etc.
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT, -- Store full name directly
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_important BOOLEAN DEFAULT FALSE,
  is_private BOOLEAN DEFAULT FALSE, -- For internal notes only
  tags TEXT[] DEFAULT '{}' -- Array of tags for categorization
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_notes_created_at ON lead_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_notes_note_type ON lead_notes(note_type);
CREATE INDEX IF NOT EXISTS idx_lead_notes_is_important ON lead_notes(is_important);
CREATE INDEX IF NOT EXISTS idx_lead_notes_created_by ON lead_notes(created_by);

-- Enable Row Level Security
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view notes for leads they have access to" ON lead_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = lead_notes.lead_id 
      AND (leads.handler = auth.jwt() ->> 'email' OR leads.manager = auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Users can insert notes for leads they have access to" ON lead_notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = lead_notes.lead_id 
      AND (leads.handler = auth.jwt() ->> 'email' OR leads.manager = auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "Users can update notes they created" ON lead_notes
  FOR UPDATE USING (
    lead_notes.created_by = auth.uid()
  );

CREATE POLICY "Users can delete notes they created" ON lead_notes
  FOR DELETE USING (
    lead_notes.created_by = auth.uid()
  );

-- Create function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_lead_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_lead_notes_updated_at
  BEFORE UPDATE ON lead_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_notes_updated_at();

-- Create function to get user full name for notes
CREATE OR REPLACE FUNCTION get_user_full_name_for_notes(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_full_name TEXT;
BEGIN
  SELECT full_name INTO user_full_name
  FROM users
  WHERE id = p_user_id;
  
  RETURN COALESCE(user_full_name, 'Unknown User');
END;
$$ LANGUAGE plpgsql;

-- Create function to create note with user name tracking
CREATE OR REPLACE FUNCTION create_lead_note(
  p_lead_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_note_type TEXT DEFAULT 'general',
  p_is_important BOOLEAN DEFAULT FALSE,
  p_is_private BOOLEAN DEFAULT FALSE,
  p_tags TEXT[] DEFAULT '{}'
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
    tags
  ) VALUES (
    p_lead_id,
    p_title,
    p_content,
    p_note_type,
    auth.uid(),
    v_user_full_name,
    p_is_important,
    p_is_private,
    p_tags
  ) RETURNING id INTO v_note_id;
  
  RETURN v_note_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to update note
CREATE OR REPLACE FUNCTION update_lead_note(
  p_note_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_note_type TEXT,
  p_is_important BOOLEAN,
  p_is_private BOOLEAN,
  p_tags TEXT[]
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
    updated_at = NOW()
  WHERE id = p_note_id AND created_by = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql; 