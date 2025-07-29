-- Allow payment_plan_id to be NULL for deletion records
ALTER TABLE payment_plan_changes ALTER COLUMN payment_plan_id DROP NOT NULL;

-- Update the foreign key constraint to allow NULL values
ALTER TABLE payment_plan_changes DROP CONSTRAINT IF EXISTS payment_plan_changes_payment_plan_id_fkey;
ALTER TABLE payment_plan_changes ADD CONSTRAINT payment_plan_changes_payment_plan_id_fkey 
  FOREIGN KEY (payment_plan_id) REFERENCES payment_plans(id) ON DELETE CASCADE; 