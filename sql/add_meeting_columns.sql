-- Add meeting-related columns to leads table for MeetingTab functionality
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS meeting_date date,
ADD COLUMN IF NOT EXISTS meeting_time time,
ADD COLUMN IF NOT EXISTS meeting_manager text,
ADD COLUMN IF NOT EXISTS meeting_location text DEFAULT 'Teams',
ADD COLUMN IF NOT EXISTS meeting_brief text,
ADD COLUMN IF NOT EXISTS meeting_currency text DEFAULT 'NIS',
ADD COLUMN IF NOT EXISTS meeting_amount decimal(10,2) DEFAULT 0.0;

-- Add comments for documentation
COMMENT ON COLUMN leads.meeting_date IS 'Date of the scheduled meeting';
COMMENT ON COLUMN leads.meeting_time IS 'Time of the scheduled meeting';
COMMENT ON COLUMN leads.meeting_manager IS 'Manager assigned to the meeting';
COMMENT ON COLUMN leads.meeting_location IS 'Location of the meeting (Teams, Jerusalem Office, etc.)';
COMMENT ON COLUMN leads.meeting_brief IS 'Brief description of the meeting';
COMMENT ON COLUMN leads.meeting_currency IS 'Currency for meeting value (NIS, USD, EUR)';
COMMENT ON COLUMN leads.meeting_amount IS 'Amount/value of the meeting'; 