-- Fix the foreign key constraint for user_changes_history table
-- Make changed_by nullable and allow it to be set to NULL when the user doesn't exist

-- First, drop the existing foreign key constraint
ALTER TABLE user_changes_history DROP CONSTRAINT IF EXISTS user_changes_history_changed_by_fkey;

-- Add the constraint back with ON DELETE SET NULL
ALTER TABLE user_changes_history ADD CONSTRAINT user_changes_history_changed_by_fkey 
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Update the trigger function to handle NULL changed_by values
CREATE OR REPLACE FUNCTION log_user_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Set updated_at automatically (updated_by will be set by the application)
        NEW.updated_at = NOW();
        
        -- Log changes for each modified column (handle NULL changed_by gracefully)
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