-- Add proposal column to leads_lead table for storing price offer proposal text
-- This allows legacy leads to store proposal text similar to new leads

ALTER TABLE leads_lead 
ADD COLUMN IF NOT EXISTS proposal TEXT;

-- Add comment for documentation
COMMENT ON COLUMN leads_lead.proposal IS 'Proposal text for price offers sent to the client';

