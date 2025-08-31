-- Add stage change tracking columns to leads_lead table for legacy leads
ALTER TABLE leads_lead 
ADD COLUMN IF NOT EXISTS stage_changed_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create an index for better query performance
CREATE INDEX IF NOT EXISTS idx_leads_lead_stage_changed_at ON leads_lead(stage_changed_at);

-- Create a function to update stage change tracking for legacy leads
CREATE OR REPLACE FUNCTION update_legacy_stage_change_tracking()
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

-- Create trigger to automatically update stage_changed_at for legacy leads
DROP TRIGGER IF EXISTS trigger_update_legacy_stage_change_tracking ON leads_lead;
CREATE TRIGGER trigger_update_legacy_stage_change_tracking
    BEFORE UPDATE ON leads_lead
    FOR EACH ROW
    EXECUTE FUNCTION update_legacy_stage_change_tracking();

-- Add comment to document the new columns
COMMENT ON COLUMN leads_lead.stage_changed_by IS 'Full name of the user who last changed the stage';
COMMENT ON COLUMN leads_lead.stage_changed_at IS 'Timestamp when the stage was last changed';
