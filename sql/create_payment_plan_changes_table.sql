-- Create payment_plan_changes table for tracking changes to payment plans
CREATE TABLE IF NOT EXISTS payment_plan_changes (
  id SERIAL PRIMARY KEY,
  payment_plan_id INTEGER NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payment_plan_changes_payment_plan_id ON payment_plan_changes(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_payment_plan_changes_changed_at ON payment_plan_changes(changed_at);

-- Add comments
COMMENT ON TABLE payment_plan_changes IS 'Tracks all changes made to payment plans for audit purposes';
COMMENT ON COLUMN payment_plan_changes.payment_plan_id IS 'Reference to the payment plan that was changed';
COMMENT ON COLUMN payment_plan_changes.field_name IS 'Name of the field that was changed';
COMMENT ON COLUMN payment_plan_changes.old_value IS 'Previous value of the field';
COMMENT ON COLUMN payment_plan_changes.new_value IS 'New value of the field';
COMMENT ON COLUMN payment_plan_changes.changed_by IS 'User who made the change';
COMMENT ON COLUMN payment_plan_changes.changed_at IS 'Timestamp when the change was made'; 