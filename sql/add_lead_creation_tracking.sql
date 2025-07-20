-- Add lead creation tracking columns to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_by_full_name VARCHAR(255);

-- Create an index for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);

-- Add comment to document the new columns
COMMENT ON COLUMN leads.created_by IS 'Email of the user who created the lead';
COMMENT ON COLUMN leads.created_by_full_name IS 'Full name of the user who created the lead'; 