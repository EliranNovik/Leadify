-- Add tracking columns to leads table for ExpertTab functionality

-- Expert notes tracking columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expert_notes_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expert_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Handler notes tracking columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handler_notes_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handler_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Section eligibility tracking columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS section_eligibility_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS section_eligibility_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Eligibility status tracking columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS eligibility_status_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS eligibility_status_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance on commonly queried columns
CREATE INDEX IF NOT EXISTS idx_leads_expert_notes_edited_at ON leads(expert_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_handler_notes_edited_at ON leads(handler_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_section_eligibility_edited_at ON leads(section_eligibility_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_eligibility_status_edited_at ON leads(eligibility_status_last_edited_at);

-- Add comments to document the new columns
COMMENT ON COLUMN leads.expert_notes_last_edited_by IS 'User who last edited expert notes';
COMMENT ON COLUMN leads.expert_notes_last_edited_at IS 'Timestamp when expert notes were last edited';
COMMENT ON COLUMN leads.handler_notes_last_edited_by IS 'User who last edited handler notes';
COMMENT ON COLUMN leads.handler_notes_last_edited_at IS 'Timestamp when handler notes were last edited';
COMMENT ON COLUMN leads.section_eligibility_last_edited_by IS 'User who last edited section eligibility';
COMMENT ON COLUMN leads.section_eligibility_last_edited_at IS 'Timestamp when section eligibility was last edited';
COMMENT ON COLUMN leads.eligibility_status_last_edited_by IS 'User who last edited eligibility status';
COMMENT ON COLUMN leads.eligibility_status_last_edited_at IS 'Timestamp when eligibility status was last edited';
