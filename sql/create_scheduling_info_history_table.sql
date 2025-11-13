-- Create scheduling information history table
-- Tracks all scheduling information updates with timestamps and user information
-- Integrated with lead_notes table for unified notes management

CREATE TABLE IF NOT EXISTS scheduling_info_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  legacy_lead_id bigint REFERENCES leads_lead(id) ON DELETE CASCADE,
  meeting_scheduling_notes text,
  next_followup date,
  followup text,
  followup_log text, -- For legacy leads
  created_by text NOT NULL, -- User who made the change
  created_at timestamptz DEFAULT now(),
  -- Link to lead_notes if this entry was also saved as a note
  note_id uuid REFERENCES lead_notes(id) ON DELETE SET NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_scheduling_info_history_lead_id ON scheduling_info_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_info_history_legacy_lead_id ON scheduling_info_history(legacy_lead_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_info_history_created_at ON scheduling_info_history(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduling_info_history_note_id ON scheduling_info_history(note_id);

-- Add comments for documentation
COMMENT ON TABLE scheduling_info_history IS 'Tracks all scheduling information updates for leads, integrated with lead_notes';
COMMENT ON COLUMN scheduling_info_history.lead_id IS 'Reference to new leads table (UUID)';
COMMENT ON COLUMN scheduling_info_history.legacy_lead_id IS 'Reference to legacy leads_lead table (bigint)';
COMMENT ON COLUMN scheduling_info_history.meeting_scheduling_notes IS 'Scheduling notes at the time of update';
COMMENT ON COLUMN scheduling_info_history.next_followup IS 'Next follow-up date at the time of update';
COMMENT ON COLUMN scheduling_info_history.followup IS 'Follow-up notes for new leads';
COMMENT ON COLUMN scheduling_info_history.followup_log IS 'Follow-up log for legacy leads';
COMMENT ON COLUMN scheduling_info_history.created_by IS 'User who created this history entry';
COMMENT ON COLUMN scheduling_info_history.created_at IS 'Timestamp when this entry was created';
COMMENT ON COLUMN scheduling_info_history.note_id IS 'Optional link to lead_notes table if this entry was also saved as a note';

