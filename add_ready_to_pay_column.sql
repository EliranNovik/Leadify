-- Add ready_to_pay column to both payment plan tables
-- This allows manual control over when payments should appear in the collection page

-- Add ready_to_pay column to finances_paymentplanrow table (legacy leads)
ALTER TABLE public.finances_paymentplanrow 
ADD COLUMN IF NOT EXISTS ready_to_pay boolean DEFAULT false;

-- Add ready_to_pay column to payment_plans table (new leads)
ALTER TABLE public.payment_plans 
ADD COLUMN IF NOT EXISTS ready_to_pay boolean DEFAULT false;

-- Add comments to document the purpose
COMMENT ON COLUMN public.finances_paymentplanrow.ready_to_pay IS 'Indicates if payment is ready to be collected (appears in collection page awaiting payments)';
COMMENT ON COLUMN public.payment_plans.ready_to_pay IS 'Indicates if payment is ready to be collected (appears in collection page awaiting payments)';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name IN ('finances_paymentplanrow', 'payment_plans') 
AND column_name = 'ready_to_pay';
