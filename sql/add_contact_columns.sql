-- Add contact-related columns to leads table for ContactInfoTab functionality
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS mobile text DEFAULT '---',
ADD COLUMN IF NOT EXISTS additional_contacts jsonb DEFAULT '[]';

-- Add comments for documentation
COMMENT ON COLUMN leads.mobile IS 'Mobile phone number for the lead';
COMMENT ON COLUMN leads.additional_contacts IS 'JSON array of additional contact information'; 