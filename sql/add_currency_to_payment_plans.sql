-- Add currency column to payment_plans table
ALTER TABLE payment_plans 
ADD COLUMN IF NOT EXISTS currency TEXT;

-- Add comment for documentation
COMMENT ON COLUMN payment_plans.currency IS 'Currency for the payment plan (e.g., USD, EUR, ₪)';
