-- Add stage column to leads table for lead stage tracking
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS stage text DEFAULT 'created';

-- Add comment for documentation
COMMENT ON COLUMN leads.stage IS 'Current stage of the lead (created, meeting_scheduled, meeting_paid, etc.)';

-- Update existing leads to have 'created' stage if they don't have one
UPDATE leads 
SET stage = 'created' 
WHERE stage IS NULL; 