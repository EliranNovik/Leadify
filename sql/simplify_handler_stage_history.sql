-- Simplify handler stage history table by removing the trigger

-- Drop the trigger and function
DROP TRIGGER IF EXISTS trigger_update_handler_stage_history_changed_by_name ON lead_handler_stage_history;
DROP FUNCTION IF EXISTS update_handler_stage_history_changed_by_name();

-- Update the table to make changed_by_name nullable (since we'll handle it in the app)
ALTER TABLE lead_handler_stage_history 
ALTER COLUMN changed_by_name DROP NOT NULL;

-- Simplify RLS policies
DROP POLICY IF EXISTS "Users can view handler stage history for accessible leads" ON lead_handler_stage_history;
DROP POLICY IF EXISTS "Authenticated users can insert handler stage history" ON lead_handler_stage_history;
DROP POLICY IF EXISTS "Authenticated users can manage handler stage history" ON lead_handler_stage_history;

-- Create a simple policy for authenticated users
CREATE POLICY "Authenticated users can manage handler stage history" ON lead_handler_stage_history
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Grant necessary permissions
GRANT ALL ON lead_handler_stage_history TO authenticated; 