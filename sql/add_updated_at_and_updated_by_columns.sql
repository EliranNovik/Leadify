-- Add updated_at and updated_by columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- Create index for better performance on updated_at
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
CREATE INDEX IF NOT EXISTS idx_users_updated_by ON users(updated_by);

-- Update the existing trigger to include updated_at and updated_by tracking
CREATE OR REPLACE FUNCTION log_user_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Set updated_at automatically (updated_by will be set by the application)
        NEW.updated_at = NOW();
        
        -- Log changes for each modified column (without tracking who made the change for now)
        IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'full_name', OLD.full_name, NEW.full_name);
        END IF;
        
        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'is_active', OLD.is_active::TEXT, NEW.is_active::TEXT);
        END IF;
        
        IF OLD.is_staff IS DISTINCT FROM NEW.is_staff THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'is_staff', OLD.is_staff::TEXT, NEW.is_staff::TEXT);
        END IF;
        
        IF OLD.is_superuser IS DISTINCT FROM NEW.is_superuser THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'is_superuser', OLD.is_superuser::TEXT, NEW.is_superuser::TEXT);
        END IF;
        
        IF OLD.groups IS DISTINCT FROM NEW.groups THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'groups', array_to_string(OLD.groups, ','), array_to_string(NEW.groups, ','));
        END IF;
        
        IF OLD.user_permissions IS DISTINCT FROM NEW.user_permissions THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'user_permissions', array_to_string(OLD.user_permissions, ','), array_to_string(NEW.user_permissions, ','));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to set configuration values for triggers
CREATE OR REPLACE FUNCTION set_config(key text, value text)
RETURNS void AS $$
BEGIN
    PERFORM set_config(key, value, false);
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS user_changes_trigger ON users;
CREATE TRIGGER user_changes_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_user_change(); 