-- Add contact_name column to contracts table
-- This column will store the actual contact name for better display in the UI

ALTER TABLE contracts 
ADD COLUMN contact_name TEXT;

-- Add a comment to explain the column
COMMENT ON COLUMN contracts.contact_name IS 'Stores the actual contact name for display purposes, avoiding the need to resolve contact_id to name';

-- Create an index for better query performance
CREATE INDEX idx_contracts_contact_name ON contracts(contact_name); 