-- Add missing columns to leads_lead table for ExpertTab functionality

-- Expert notes columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_notes JSONB;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS handler_notes JSONB;

-- Expert assessment columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_eligibility_assessed BOOLEAN DEFAULT FALSE;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_eligibility_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_eligibility_assessed_by TEXT;

-- Special notes tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS special_notes_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS special_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- General notes tracking columns (using 'notes' field)
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS notes_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Facts/Description tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS description_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS description_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Anchor tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS anchor_full_name_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS anchor_full_name_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Category/Tags tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS category_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS category_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Expert notes tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_notes_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS expert_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Handler notes tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS handler_notes_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS handler_notes_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Section eligibility tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS section_eligibility_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS section_eligibility_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Eligibility status tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS eligibility_status_last_edited_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS eligibility_status_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Document upload tracking columns
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS documents_uploaded_by TEXT;
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS documents_uploaded_date TIMESTAMP WITH TIME ZONE;

-- OneDrive folder link column
ALTER TABLE leads_lead ADD COLUMN IF NOT EXISTS onedrive_folder_link TEXT;

-- Add indexes for performance on commonly queried columns
CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_eligibility_assessed ON leads_lead(expert_eligibility_assessed);
CREATE INDEX IF NOT EXISTS idx_leads_lead_special_notes_edited_at ON leads_lead(special_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_lead_notes_edited_at ON leads_lead(notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_lead_description_edited_at ON leads_lead(description_last_edited_at);

-- Add comments to document the new columns
COMMENT ON COLUMN leads_lead.expert_notes IS 'JSON array of expert notes';
COMMENT ON COLUMN leads_lead.handler_notes IS 'JSON array of handler notes';
COMMENT ON COLUMN leads_lead.expert_eligibility_assessed IS 'Whether expert eligibility assessment has been completed';
COMMENT ON COLUMN leads_lead.expert_eligibility_date IS 'Date when expert eligibility was assessed';
COMMENT ON COLUMN leads_lead.expert_eligibility_assessed_by IS 'User who completed the expert eligibility assessment';
COMMENT ON COLUMN leads_lead.special_notes_last_edited_by IS 'User who last edited special notes';
COMMENT ON COLUMN leads_lead.special_notes_last_edited_at IS 'Timestamp when special notes were last edited';
COMMENT ON COLUMN leads_lead.notes_last_edited_by IS 'User who last edited general notes';
COMMENT ON COLUMN leads_lead.notes_last_edited_at IS 'Timestamp when general notes were last edited';
COMMENT ON COLUMN leads_lead.description_last_edited_by IS 'User who last edited facts/description';
COMMENT ON COLUMN leads_lead.description_last_edited_at IS 'Timestamp when facts/description were last edited';
COMMENT ON COLUMN leads_lead.anchor_full_name_last_edited_by IS 'User who last edited anchor information';
COMMENT ON COLUMN leads_lead.anchor_full_name_last_edited_at IS 'Timestamp when anchor information was last edited';
COMMENT ON COLUMN leads_lead.category_last_edited_by IS 'User who last edited category/tags';
COMMENT ON COLUMN leads_lead.category_last_edited_at IS 'Timestamp when category/tags were last edited';
COMMENT ON COLUMN leads_lead.expert_notes_last_edited_by IS 'User who last edited expert notes';
COMMENT ON COLUMN leads_lead.expert_notes_last_edited_at IS 'Timestamp when expert notes were last edited';
COMMENT ON COLUMN leads_lead.handler_notes_last_edited_by IS 'User who last edited handler notes';
COMMENT ON COLUMN leads_lead.handler_notes_last_edited_at IS 'Timestamp when handler notes were last edited';
COMMENT ON COLUMN leads_lead.section_eligibility_last_edited_by IS 'User who last edited section eligibility';
COMMENT ON COLUMN leads_lead.section_eligibility_last_edited_at IS 'Timestamp when section eligibility was last edited';
COMMENT ON COLUMN leads_lead.eligibility_status_last_edited_by IS 'User who last edited eligibility status';
COMMENT ON COLUMN leads_lead.eligibility_status_last_edited_at IS 'Timestamp when eligibility status was last edited';
COMMENT ON COLUMN leads_lead.documents_uploaded_by IS 'User who uploaded documents';
COMMENT ON COLUMN leads_lead.documents_uploaded_date IS 'Date when documents were uploaded';
COMMENT ON COLUMN leads_lead.onedrive_folder_link IS 'Link to OneDrive folder for documents';
