-- Add missing columns to leads table for InfoTab functionality
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS tags text,
ADD COLUMN IF NOT EXISTS anchor text,
ADD COLUMN IF NOT EXISTS probability integer DEFAULT 50,
ADD COLUMN IF NOT EXISTS general_notes text;

-- Add comments for documentation
COMMENT ON COLUMN leads.tags IS 'Tags for categorizing leads';
COMMENT ON COLUMN leads.anchor IS 'Anchor information for the lead';
COMMENT ON COLUMN leads.probability IS 'Probability percentage (0-100) of successful case';
COMMENT ON COLUMN leads.general_notes IS 'General notes about the lead'; 