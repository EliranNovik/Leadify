-- Add new columns to users table for enhanced user management
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_joined TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS groups TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_permissions TEXT[] DEFAULT '{}';

-- Create user_changes_history table for tracking changes
CREATE TABLE IF NOT EXISTS user_changes_history (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_user_changes_history_user_id ON user_changes_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_changes_history_changed_at ON user_changes_history(changed_at);

-- Create groups table
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    codename VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert some default groups
INSERT INTO groups (name, description) VALUES
    ('Admin', 'Full system access and admin panel access'),
    ('Users', 'Basic user access'),
    ('Template Access', 'Access to contract templates in admin panel (Misc tab)'),
    ('Public Messages Access', 'Access to public messages in admin panel (Misc tab)')
ON CONFLICT (name) DO NOTHING;

-- Insert some default permissions
INSERT INTO permissions (name, codename, description) VALUES
    ('Can view leads', 'view_leads', 'Can view lead information'),
    ('Can edit leads', 'edit_leads', 'Can edit lead information'),
    ('Can delete leads', 'delete_leads', 'Can delete leads'),
    ('Can create leads', 'create_leads', 'Can create new leads'),
    ('Can view reports', 'view_reports', 'Can view system reports'),
    ('Can manage users', 'manage_users', 'Can manage other users'),
    ('Can access admin', 'access_admin', 'Can access admin panel'),
    ('Can send emails', 'send_emails', 'Can send emails to clients'),
    ('Can schedule meetings', 'schedule_meetings', 'Can schedule client meetings'),
    ('Can view finances', 'view_finances', 'Can view financial information')
ON CONFLICT (codename) DO NOTHING;

-- Create function to log user changes
CREATE OR REPLACE FUNCTION log_user_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Log changes for each modified column
        IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'full_name', OLD.full_name, NEW.full_name);
        END IF;
        
        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'is_active', OLD.is_active::TEXT, NEW.is_active::TEXT);
        END IF;
        
        IF OLD.is_staff IS DISTINCT FROM NEW.is_staff THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'is_staff', OLD.is_staff::TEXT, NEW.is_staff::TEXT);
        END IF;
        
        IF OLD.is_superuser IS DISTINCT FROM NEW.is_superuser THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'is_superuser', OLD.is_superuser::TEXT, NEW.is_superuser::TEXT);
        END IF;
        
        IF OLD.groups IS DISTINCT FROM NEW.groups THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'groups', array_to_string(OLD.groups, ','), array_to_string(NEW.groups, ','));
        END IF;
        
        IF OLD.user_permissions IS DISTINCT FROM NEW.user_permissions THEN
            INSERT INTO user_changes_history (user_id, changed_by, field_name, old_value, new_value)
            VALUES (NEW.id, current_setting('app.current_user_id', true)::UUID, 'user_permissions', array_to_string(OLD.user_permissions, ','), array_to_string(NEW.user_permissions, ','));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically log user changes
DROP TRIGGER IF EXISTS user_changes_trigger ON users;
CREATE TRIGGER user_changes_trigger
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION log_user_change(); 