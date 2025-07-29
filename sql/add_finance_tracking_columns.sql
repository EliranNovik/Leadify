-- Add tracking columns to payment_plans table
ALTER TABLE payment_plans 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add tracking columns to contracts table (if it doesn't have them already)
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create a finance_changes_history table to track all finance-related changes
CREATE TABLE IF NOT EXISTS finance_changes_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    change_type VARCHAR(100) NOT NULL, -- 'payment_created', 'payment_updated', 'payment_deleted', 'payment_marked_paid', 'contract_created', 'contract_updated', 'auto_plan_created'
    table_name VARCHAR(50) NOT NULL, -- 'payment_plans', 'contracts'
    record_id UUID, -- ID of the affected record
    old_values JSONB, -- Previous values (for updates)
    new_values JSONB, -- New values
    changed_by VARCHAR(255) NOT NULL, -- User who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT -- Additional notes about the change
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_finance_changes_history_lead_id ON finance_changes_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_finance_changes_history_changed_at ON finance_changes_history(changed_at);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at and track changes
CREATE OR REPLACE FUNCTION track_finance_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_name VARCHAR(255);
    change_type VARCHAR(100);
    old_data JSONB;
    new_data JSONB;
BEGIN
    -- Get current user from session (you may need to adjust this based on your auth setup)
    current_user_name := COALESCE(current_setting('app.current_user', true), 'Unknown User');
    
    -- Determine change type
    IF TG_OP = 'INSERT' THEN
        change_type := 'payment_created';
        new_data := to_jsonb(NEW);
        old_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        change_type := 'payment_updated';
        new_data := to_jsonb(NEW);
        old_data := to_jsonb(OLD);
    ELSIF TG_OP = 'DELETE' THEN
        change_type := 'payment_deleted';
        new_data := NULL;
        old_data := to_jsonb(OLD);
    END IF;
    
    -- Insert into history table
    INSERT INTO finance_changes_history (
        lead_id,
        change_type,
        table_name,
        record_id,
        old_values,
        new_values,
        changed_by,
        notes
    ) VALUES (
        NEW.lead_id,
        change_type,
        TG_TABLE_NAME,
        NEW.id,
        old_data,
        new_data,
        current_user_name,
        'Finance change tracked automatically'
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for payment_plans table
DROP TRIGGER IF EXISTS track_payment_plans_changes ON payment_plans;
CREATE TRIGGER track_payment_plans_changes
    AFTER INSERT OR UPDATE OR DELETE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION track_finance_changes();

-- Create trigger for contracts table
DROP TRIGGER IF EXISTS track_contracts_changes ON contracts;
CREATE TRIGGER track_contracts_changes
    AFTER INSERT OR UPDATE OR DELETE ON contracts
    FOR EACH ROW EXECUTE FUNCTION track_finance_changes();

-- Create trigger to update updated_at column
DROP TRIGGER IF EXISTS update_payment_plans_updated_at ON payment_plans;
CREATE TRIGGER update_payment_plans_updated_at
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 