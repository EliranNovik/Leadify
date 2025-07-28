-- Add first_name and last_name columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);

-- Create indexes for better performance on name searches
CREATE INDEX IF NOT EXISTS idx_users_first_name ON users(first_name);
CREATE INDEX IF NOT EXISTS idx_users_last_name ON users(last_name);

-- Update the trigger function to track changes to the new columns
CREATE OR REPLACE FUNCTION log_user_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Set updated_at automatically
        NEW.updated_at = NOW();
        
        -- Log changes for each modified column
        IF OLD.first_name IS DISTINCT FROM NEW.first_name THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'first_name', OLD.first_name, NEW.first_name);
        END IF;
        
        IF OLD.last_name IS DISTINCT FROM NEW.last_name THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, NEW.updated_by, 'last_name', OLD.last_name, NEW.last_name);
        END IF;
        
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

-- Recreate the trigger
DROP TRIGGER IF EXISTS user_changes_trigger ON users;
CREATE TRIGGER user_changes_trigger
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_user_change(); 