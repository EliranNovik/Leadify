-- Add tracking columns to payment_plans table for admin editing
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Add comments
COMMENT ON COLUMN payment_plans.updated_at IS 'Timestamp when the payment plan was last updated';
COMMENT ON COLUMN payment_plans.updated_by IS 'User who last updated the payment plan'; 