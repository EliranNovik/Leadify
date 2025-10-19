-- Fix payment_plans table by adding missing updated_at column
-- This resolves the trigger error: "record \"new\" has no field \"updated_at\""

-- Add the missing updated_at column
ALTER TABLE public.payment_plans 
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add comment to document the purpose
COMMENT ON COLUMN public.payment_plans.updated_at IS 'Timestamp when the record was last updated, automatically managed by trigger';

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'payment_plans' 
AND column_name = 'updated_at';
