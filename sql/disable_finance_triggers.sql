-- Temporarily disable finance tracking triggers to isolate the update issue
DROP TRIGGER IF EXISTS track_payment_plans_changes ON payment_plans;
DROP TRIGGER IF EXISTS track_contracts_changes ON contracts;
DROP TRIGGER IF EXISTS update_payment_plans_updated_at ON payment_plans;
DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;

-- Also drop the functions to completely remove them
DROP FUNCTION IF EXISTS track_payment_plans_changes();
DROP FUNCTION IF EXISTS track_contracts_changes();
DROP FUNCTION IF EXISTS update_updated_at_column(); 