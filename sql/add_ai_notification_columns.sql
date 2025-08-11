-- Add AI notification columns to leads table
-- This enables the AI system to track and notify about important events

-- Add expert eligibility tracking
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS expert_eligibility_assessed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS expert_eligibility_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS expert_eligibility_assessed_by TEXT;

-- Add documents uploaded tracking
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS documents_uploaded_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS documents_uploaded_by TEXT;

-- Note: Payment due dates are tracked in payment_plans table (due_date column)
-- No need to add payment_due_date to leads table

-- Add comments for documentation
COMMENT ON COLUMN leads.expert_eligibility_assessed IS 'Whether expert eligibility has been assessed';
COMMENT ON COLUMN leads.expert_eligibility_date IS 'When expert eligibility was assessed';
COMMENT ON COLUMN leads.expert_eligibility_assessed_by IS 'User who assessed expert eligibility';
COMMENT ON COLUMN leads.documents_uploaded_date IS 'When documents were last uploaded';
COMMENT ON COLUMN leads.documents_uploaded_by IS 'User who uploaded documents';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_expert_eligibility_assessed ON leads(expert_eligibility_assessed);
CREATE INDEX IF NOT EXISTS idx_leads_expert_eligibility_date ON leads(expert_eligibility_date);
CREATE INDEX IF NOT EXISTS idx_leads_documents_uploaded_date ON leads(documents_uploaded_date);
-- Payment due dates are indexed in payment_plans table
CREATE INDEX IF NOT EXISTS idx_leads_next_followup ON leads(next_followup);

-- Verify the changes
SELECT 'AI notification columns added successfully' as status;
