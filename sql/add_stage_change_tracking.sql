-- Add stage change tracking columns to leads table
ALTER TABLE leads 
ADD COLUMN stage_changed_by VARCHAR(255),
ADD COLUMN stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create an index for better query performance
CREATE INDEX idx_leads_stage_changed_at ON leads(stage_changed_at);

-- Create a function to update stage change tracking
CREATE OR REPLACE FUNCTION update_stage_change_tracking()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if stage has actually changed
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN
        NEW.stage_changed_at = NOW();
        -- stage_changed_by will be set by the application
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update stage_changed_at
CREATE TRIGGER trigger_update_stage_change_tracking
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_stage_change_tracking();

-- Add comment to document the new columns
COMMENT ON COLUMN leads.stage_changed_by IS 'Full name of the user who last changed the stage';
COMMENT ON COLUMN leads.stage_changed_at IS 'Timestamp when the stage was last changed'; 