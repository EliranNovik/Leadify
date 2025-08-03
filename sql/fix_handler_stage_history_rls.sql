-- Fix RLS policies for lead_handler_stage_history table

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view handler stage history for accessible leads" ON lead_handler_stage_history;
DROP POLICY IF EXISTS "Authenticated users can insert handler stage history" ON lead_handler_stage_history;

-- Create a more permissive policy for authenticated users
CREATE POLICY "Authenticated users can manage handler stage history" ON lead_handler_stage_history
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Alternative: If you want to disable RLS temporarily for testing
-- ALTER TABLE lead_handler_stage_history DISABLE ROW LEVEL SECURITY;

-- Grant necessary permissions to the trigger function
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON users TO authenticated;
GRANT SELECT ON auth.users TO authenticated;

-- Update the trigger function to handle permissions better
CREATE OR REPLACE FUNCTION update_handler_stage_history_changed_by_name()
RETURNS TRIGGER AS $$
BEGIN
    -- Try to get the user's full name from users table
    BEGIN
        SELECT full_name INTO NEW.changed_by_name
        FROM users
        WHERE users.id = NEW.changed_by;
    EXCEPTION WHEN OTHERS THEN
        -- If that fails, try to get email from auth.users
        BEGIN
            SELECT email INTO NEW.changed_by_name
            FROM auth.users
            WHERE auth.users.id = NEW.changed_by;
        EXCEPTION WHEN OTHERS THEN
            -- If both fail, use 'Unknown User'
            NEW.changed_by_name := 'Unknown User';
        END;
    END;
    
    -- If still null, use 'Unknown User'
    IF NEW.changed_by_name IS NULL THEN
        NEW.changed_by_name := 'Unknown User';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 