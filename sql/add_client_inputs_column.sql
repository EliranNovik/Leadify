-- Add client_inputs column to contracts table to store actual values entered by clients
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS client_inputs JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN contracts.client_inputs IS 'JSON object storing client input values for text fields and signatures (e.g., {"text-1": "John Doe", "signature-1": "data:image/png;base64,..."})';

-- Add index for better query performance
CREATE INDEX idx_contracts_client_inputs ON contracts USING GIN (client_inputs); 