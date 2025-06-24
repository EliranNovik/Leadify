-- Add role columns to leads table for RolesTab functionality
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS scheduler text DEFAULT '---',
ADD COLUMN IF NOT EXISTS manager text DEFAULT '---',
ADD COLUMN IF NOT EXISTS helper text DEFAULT '---',
ADD COLUMN IF NOT EXISTS expert text DEFAULT '---',
ADD COLUMN IF NOT EXISTS closer text DEFAULT '---';

-- Add comments for documentation
COMMENT ON COLUMN leads.scheduler IS 'Assigned scheduler for the lead';
COMMENT ON COLUMN leads.manager IS 'Assigned manager for the lead';
COMMENT ON COLUMN leads.helper IS 'Assigned helper for the lead';
COMMENT ON COLUMN leads.expert IS 'Assigned expert for the lead';
COMMENT ON COLUMN leads.closer IS 'Assigned closer for the lead'; 