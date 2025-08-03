-- Create handler stage history table
CREATE TABLE IF NOT EXISTS lead_handler_stage_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    old_handler_stage VARCHAR(50),
    new_handler_stage VARCHAR(50) NOT NULL,
    changed_by UUID NOT NULL REFERENCES auth.users(id),
    changed_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_lead_handler_stage_history_lead_id ON lead_handler_stage_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_handler_stage_history_created_at ON lead_handler_stage_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_handler_stage_history_changed_by ON lead_handler_stage_history(changed_by);

-- Add RLS policies
ALTER TABLE lead_handler_stage_history ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view handler stage history for leads they have access to
CREATE POLICY "Users can view handler stage history for accessible leads" ON lead_handler_stage_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM leads 
            WHERE leads.id = lead_handler_stage_history.lead_id
        )
    );

-- Policy to allow authenticated users to insert handler stage history
CREATE POLICY "Authenticated users can insert handler stage history" ON lead_handler_stage_history
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Function to automatically update changed_by_name when changed_by is set
CREATE OR REPLACE FUNCTION update_handler_stage_history_changed_by_name()
RETURNS TRIGGER AS $$
BEGIN
    -- Get the user's full name from users table
    SELECT full_name INTO NEW.changed_by_name
    FROM users
    WHERE users.id = NEW.changed_by;
    
    -- If full_name is not found, use email as fallback
    IF NEW.changed_by_name IS NULL THEN
        SELECT email INTO NEW.changed_by_name
        FROM auth.users
        WHERE auth.users.id = NEW.changed_by;
    END IF;
    
    -- If still null, use 'Unknown User'
    IF NEW.changed_by_name IS NULL THEN
        NEW.changed_by_name := 'Unknown User';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set changed_by_name
CREATE TRIGGER trigger_update_handler_stage_history_changed_by_name
    BEFORE INSERT ON lead_handler_stage_history
    FOR EACH ROW
    EXECUTE FUNCTION update_handler_stage_history_changed_by_name(); 