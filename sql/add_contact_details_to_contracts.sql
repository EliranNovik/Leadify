-- Add contact details columns to contracts table
-- This will store the contact's email, phone, and mobile for contract templates

ALTER TABLE contracts 
ADD COLUMN contact_email TEXT,
ADD COLUMN contact_phone TEXT,
ADD COLUMN contact_mobile TEXT;

-- Add comments to explain the columns
COMMENT ON COLUMN contracts.contact_email IS 'Stores the contact email for contract templates and communication';
COMMENT ON COLUMN contracts.contact_phone IS 'Stores the contact phone for contract templates and communication';
COMMENT ON COLUMN contracts.contact_mobile IS 'Stores the contact mobile for contract templates and communication';

-- Create indexes for better query performance
CREATE INDEX idx_contracts_contact_email ON contracts(contact_email);
CREATE INDEX idx_contracts_contact_phone ON contracts(contact_phone); 