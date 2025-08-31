-- Add unactivation-related columns to the leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS unactivated_by TEXT,
ADD COLUMN IF NOT EXISTS unactivated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS unactivation_reason TEXT;

-- Add comments to document the new columns
COMMENT ON COLUMN leads.unactivated_by IS 'Name of the user who unactivated the lead';
COMMENT ON COLUMN leads.unactivated_at IS 'Timestamp when the lead was unactivated';
COMMENT ON COLUMN leads.unactivation_reason IS 'Reason for unactivation (spam, test, not relevant, not eligible)';

-- Create an index on unactivation_reason for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_unactivation_reason ON leads(unactivation_reason);

-- Create an index on unactivated_at for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_unactivated_at ON leads(unactivated_at);

-- Update RLS policies to allow access to the new columns
-- (This assumes you have RLS enabled on the leads table)
-- The existing policies should automatically include the new columns
