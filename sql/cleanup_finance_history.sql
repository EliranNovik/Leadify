-- Clean up the unnecessary finance_changes_history table
-- Since we're now tracking everything directly in payment_plans table

-- Drop the finance_changes_history table if it exists
DROP TABLE IF EXISTS finance_changes_history;

-- Drop any related indexes
DROP INDEX IF EXISTS idx_finance_changes_history_lead_id;
DROP INDEX IF EXISTS idx_finance_changes_history_changed_at; 