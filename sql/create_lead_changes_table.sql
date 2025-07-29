-- Create lead_changes table for tracking lead field changes
CREATE TABLE IF NOT EXISTS lead_changes (
  id SERIAL PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  field_name VARCHAR(255) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by VARCHAR(255) NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_lead_changes_lead_id ON lead_changes(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_changes_changed_at ON lead_changes(changed_at);
CREATE INDEX IF NOT EXISTS idx_lead_changes_changed_by ON lead_changes(changed_by);

-- Add comments for documentation
COMMENT ON TABLE lead_changes IS 'Tracks all field changes made to leads';
COMMENT ON COLUMN lead_changes.lead_id IS 'Reference to the lead that was changed';
COMMENT ON COLUMN lead_changes.field_name IS 'Name of the field that was changed';
COMMENT ON COLUMN lead_changes.old_value IS 'Previous value of the field (can be NULL for new values)';
COMMENT ON COLUMN lead_changes.new_value IS 'New value of the field (can be NULL for deleted values)';
COMMENT ON COLUMN lead_changes.changed_by IS 'Full name of the user who made the change';
COMMENT ON COLUMN lead_changes.changed_at IS 'Timestamp when the change was made'; 