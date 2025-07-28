-- Fix user changes history display issue
-- Make the foreign key constraint more flexible and update the trigger function

-- First, drop the existing foreign key constraint if it exists
ALTER TABLE user_changes_history DROP CONSTRAINT IF EXISTS user_changes_history_changed_by_fkey;

-- Add the constraint back with ON DELETE SET NULL to handle missing users gracefully
ALTER TABLE user_changes_history ADD CONSTRAINT user_changes_history_changed_by_fkey 
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Update the trigger function to handle NULL changed_by values and provide better fallback
CREATE OR REPLACE FUNCTION log_user_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Set updated_at automatically
        NEW.updated_at = NOW();
        
        -- Log changes for each modified column
        -- If changed_by is NULL, we'll still log the change but with NULL changed_by
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

-- Create a view to display user changes with better user information
CREATE OR REPLACE VIEW user_changes_with_user_info AS
SELECT 
    uch.id,
    uch.user_id,
    uch.changed_by,
    uch.field_name,
    uch.old_value,
    uch.new_value,
    uch.changed_at,
    -- Get the name of the user who made the change
    CASE 
        WHEN uch.changed_by IS NOT NULL THEN 
            COALESCE(u.full_name, u.email, 'Unknown User')
        ELSE 
            'System'
    END as changed_by_name,
    -- Get the email of the user who made the change
    CASE 
        WHEN uch.changed_by IS NOT NULL THEN 
            u.email
        ELSE 
            NULL
    END as changed_by_email
FROM user_changes_history uch
LEFT JOIN users u ON uch.changed_by = u.id
ORDER BY uch.changed_at DESC; 