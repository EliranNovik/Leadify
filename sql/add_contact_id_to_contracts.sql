-- Add contact_id column to contracts table
-- This allows contracts to be associated with specific contacts within a lead

ALTER TABLE contracts 
ADD COLUMN contact_id INTEGER;

-- Add a comment to explain the purpose
COMMENT ON COLUMN contracts.contact_id IS 'References the contact ID within the lead. Allows multiple contracts per lead, one per contact.';

-- Create an index for better query performance
CREATE INDEX idx_contracts_contact_id ON contracts(contact_id);

-- Add a foreign key constraint if you want to ensure data integrity
-- Note: This assumes contacts are stored in a separate table or as part of the leads table
-- ALTER TABLE contracts ADD CONSTRAINT fk_contracts_contact_id FOREIGN KEY (contact_id) REFERENCES contacts(id); 