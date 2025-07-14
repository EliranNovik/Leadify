-- Add balance-related columns to leads table for financial tracking
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS balance decimal(10,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS balance_currency text DEFAULT 'NIS',
ADD COLUMN IF NOT EXISTS proposal_total decimal(10,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS proposal_currency text DEFAULT 'NIS',
ADD COLUMN IF NOT EXISTS date_signed date,
ADD COLUMN IF NOT EXISTS next_followup date,
ADD COLUMN IF NOT EXISTS created_by text;

-- Add comments for documentation
COMMENT ON COLUMN leads.balance IS 'Total balance amount for the lead';
COMMENT ON COLUMN leads.balance_currency IS 'Currency for the balance (NIS, USD, EUR)';
COMMENT ON COLUMN leads.proposal_total IS 'Total proposal amount';
COMMENT ON COLUMN leads.proposal_currency IS 'Currency for the proposal (NIS, USD, EUR)';
COMMENT ON COLUMN leads.date_signed IS 'Date when the agreement was signed';
COMMENT ON COLUMN leads.next_followup IS 'Next follow-up date';
COMMENT ON COLUMN leads.created_by IS 'User who created the lead'; 