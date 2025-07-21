-- Add client_inputs column to contracts table to store filled-in client data
ALTER TABLE contracts 
ADD COLUMN client_inputs JSONB DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN contracts.client_inputs IS 'Stores the filled-in client inputs (text fields and signatures) when contract is signed';

-- Add index for better query performance
CREATE INDEX idx_contracts_client_inputs ON contracts USING GIN (client_inputs); 