-- Fix the finance tracking triggers to work with the actual database schema
-- First, let's check what columns exist in payment_plans table
-- Then create a more robust trigger function

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS track_payment_plans_changes ON payment_plans;
DROP TRIGGER IF EXISTS track_contracts_changes ON contracts;
DROP TRIGGER IF EXISTS update_payment_plans_updated_at ON payment_plans;
DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;

-- Drop the functions
DROP FUNCTION IF EXISTS track_finance_changes();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a more robust trigger function for payment_plans
CREATE OR REPLACE FUNCTION track_payment_plans_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_name VARCHAR(255);
    change_type VARCHAR(100);
    old_data JSONB;
    new_data JSONB;
    lead_id_val UUID;
BEGIN
    -- Get current user from session or use a default
    current_user_name := COALESCE(current_setting('app.current_user', true), 'Unknown User');
    
    -- Get lead_id from the record
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        lead_id_val := NEW.lead_id;
    ELSIF TG_OP = 'DELETE' THEN
        lead_id_val := OLD.lead_id;
    END IF;
    
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
    
    -- Insert into history table only if we have a lead_id
    IF lead_id_val IS NOT NULL THEN
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
            lead_id_val,
            change_type,
            'payment_plans',
            COALESCE(NEW.id, OLD.id),
            old_data,
            new_data,
            current_user_name,
            'Finance change tracked automatically'
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create a more robust trigger function for contracts
CREATE OR REPLACE FUNCTION track_contracts_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_name VARCHAR(255);
    change_type VARCHAR(100);
    old_data JSONB;
    new_data JSONB;
    lead_id_val UUID;
BEGIN
    -- Get current user from session or use a default
    current_user_name := COALESCE(current_setting('app.current_user', true), 'Unknown User');
    
    -- Get lead_id from the record (assuming contracts table has client_id that references leads)
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        lead_id_val := NEW.client_id;
    ELSIF TG_OP = 'DELETE' THEN
        lead_id_val := OLD.client_id;
    END IF;
    
    -- Determine change type
    IF TG_OP = 'INSERT' THEN
        change_type := 'contract_created';
        new_data := to_jsonb(NEW);
        old_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        change_type := 'contract_updated';
        new_data := to_jsonb(NEW);
        old_data := to_jsonb(OLD);
    ELSIF TG_OP = 'DELETE' THEN
        change_type := 'contract_deleted';
        new_data := NULL;
        old_data := to_jsonb(OLD);
    END IF;
    
    -- Insert into history table only if we have a lead_id
    IF lead_id_val IS NOT NULL THEN
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
            lead_id_val,
            change_type,
            'contracts',
            COALESCE(NEW.id, OLD.id),
            old_data,
            new_data,
            current_user_name,
            'Finance change tracked automatically'
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for payment_plans table
CREATE TRIGGER track_payment_plans_changes
    AFTER INSERT OR UPDATE OR DELETE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION track_payment_plans_changes();

-- Create trigger for contracts table
CREATE TRIGGER track_contracts_changes
    AFTER INSERT OR UPDATE OR DELETE ON contracts
    FOR EACH ROW EXECUTE FUNCTION track_contracts_changes();

-- Create trigger to update updated_at column for payment_plans
CREATE TRIGGER update_payment_plans_updated_at
    BEFORE UPDATE ON payment_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to update updated_at column for contracts
CREATE TRIGGER update_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 