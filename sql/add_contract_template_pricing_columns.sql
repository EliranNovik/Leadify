-- Add columns to contract_templates table for storing default pricing tiers
-- This allows each template to have its own default pricing configuration

-- Add default_pricing_tiers column to store the pricing tier structure as JSON
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS default_pricing_tiers JSONB DEFAULT '{
  "1": 2500,
  "2": 2400,
  "3": 2300,
  "4-7": 2200,
  "8-9": 2100,
  "10-15": 2000,
  "16+": 1900
}'::jsonb;

-- Add default_currency column to store the default currency for the template
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) DEFAULT 'USD';

-- Add default_country column to store the default country for the template
ALTER TABLE contract_templates 
ADD COLUMN IF NOT EXISTS default_country VARCHAR(2) DEFAULT 'US';

-- Add comment to explain the pricing tiers structure
COMMENT ON COLUMN contract_templates.default_pricing_tiers IS 'JSON object storing default pricing tiers for each applicant count. Keys: "1", "2", "3", "4-7", "8-9", "10-15", "16+"';

COMMENT ON COLUMN contract_templates.default_currency IS 'Default currency for the template (USD, NIS, etc.)';

COMMENT ON COLUMN contract_templates.default_country IS 'Default country for the template (US, IL, etc.)';

-- Create index on default_currency for better query performance
CREATE INDEX IF NOT EXISTS idx_contract_templates_default_currency ON contract_templates(default_currency);

-- Create index on default_country for better query performance  
CREATE INDEX IF NOT EXISTS idx_contract_templates_default_country ON contract_templates(default_country); 