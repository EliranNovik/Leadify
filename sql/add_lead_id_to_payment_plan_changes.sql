-- Add lead_id column to payment_plan_changes table for better tracking
ALTER TABLE payment_plan_changes ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id);

-- Update existing records to have lead_id by joining with payment_plans
UPDATE payment_plan_changes 
SET lead_id = payment_plans.lead_id 
FROM payment_plans 
WHERE payment_plan_changes.payment_plan_id = payment_plans.id;

-- Make lead_id NOT NULL after populating existing records
ALTER TABLE payment_plan_changes ALTER COLUMN lead_id SET NOT NULL;

-- Add index for lead_id
CREATE INDEX IF NOT EXISTS idx_payment_plan_changes_lead_id ON payment_plan_changes(lead_id); 