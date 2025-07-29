-- Remove the CASCADE DELETE constraint to preserve history when payment plans are deleted
ALTER TABLE payment_plan_changes DROP CONSTRAINT IF EXISTS payment_plan_changes_payment_plan_id_fkey;

-- Add the constraint back without CASCADE DELETE
ALTER TABLE payment_plan_changes ADD CONSTRAINT payment_plan_changes_payment_plan_id_fkey 
  FOREIGN KEY (payment_plan_id) REFERENCES payment_plans(id) ON DELETE SET NULL;

-- Update existing records that might have orphaned payment_plan_id references
UPDATE payment_plan_changes 
SET payment_plan_id = NULL 
WHERE payment_plan_id NOT IN (SELECT id FROM payment_plans); 