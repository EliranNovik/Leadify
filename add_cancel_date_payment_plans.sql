-- Add cancel_date column to payment_plans table for soft delete functionality
-- This matches the soft delete functionality in finances_paymentplanrow table for legacy leads

-- Add cancel_date column to payment_plans table
ALTER TABLE public.payment_plans 
ADD COLUMN IF NOT EXISTS cancel_date date DEFAULT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN public.payment_plans.cancel_date IS 'Date when the payment was cancelled/deleted for soft delete functionality';

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'payment_plans' 
AND column_name = 'cancel_date';
