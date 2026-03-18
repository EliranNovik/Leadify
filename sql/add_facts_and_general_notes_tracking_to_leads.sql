-- Add Facts of Case and General Notes tracking columns to leads table
-- These columns are referenced by history triggers but may not exist if migrations were run out of order

-- Facts of Case tracking (InfoTab)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS facts_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS facts_last_edited_at TIMESTAMP WITH TIME ZONE;

-- General Notes tracking (InfoTab)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS general_notes_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS general_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_facts_edited_at ON leads(facts_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_general_notes_edited_at ON leads(general_notes_last_edited_at);

-- Add comments for documentation
COMMENT ON COLUMN leads.facts_last_edited_by IS 'User who last edited facts of case';
COMMENT ON COLUMN leads.facts_last_edited_at IS 'Timestamp when facts of case were last edited';
COMMENT ON COLUMN leads.general_notes_last_edited_by IS 'User who last edited general notes';
COMMENT ON COLUMN leads.general_notes_last_edited_at IS 'Timestamp when general notes were last edited';
