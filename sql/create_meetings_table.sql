-- Create meetings table
CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    client_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    meeting_date DATE,
    meeting_time TIME,
    meeting_location TEXT DEFAULT 'Teams',
    meeting_manager TEXT,
    meeting_currency TEXT DEFAULT 'NIS',
    meeting_amount DECIMAL(10,2) DEFAULT 0.0,
    meeting_brief TEXT,
    scheduler TEXT,
    helper TEXT,
    expert TEXT,
    teams_meeting_url TEXT,
    last_edited_timestamp TIMESTAMP WITH TIME ZONE,
    last_edited_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'scheduled'
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_meetings_client_id ON meetings(client_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);

-- Add comments for documentation
COMMENT ON TABLE meetings IS 'Stores all meetings for clients';
COMMENT ON COLUMN meetings.id IS 'Primary key for the meetings table';
COMMENT ON COLUMN meetings.client_id IS 'Reference to the leads table (UUID)';
COMMENT ON COLUMN meetings.meeting_date IS 'Date of the scheduled meeting';
COMMENT ON COLUMN meetings.meeting_time IS 'Time of the scheduled meeting';
COMMENT ON COLUMN meetings.meeting_location IS 'Location of the meeting (Teams, Jerusalem Office, etc.)';
COMMENT ON COLUMN meetings.meeting_manager IS 'Manager assigned to the meeting';
COMMENT ON COLUMN meetings.meeting_currency IS 'Currency for meeting value (NIS, USD, EUR)';
COMMENT ON COLUMN meetings.meeting_amount IS 'Amount/value of the meeting';
COMMENT ON COLUMN meetings.meeting_brief IS 'Brief description of the meeting';
COMMENT ON COLUMN meetings.scheduler IS 'Person who scheduled the meeting';
COMMENT ON COLUMN meetings.helper IS 'Helper assigned to the meeting';
COMMENT ON COLUMN meetings.expert IS 'Expert assigned to the meeting';
COMMENT ON COLUMN meetings.teams_meeting_url IS 'URL for Teams meeting if applicable';
COMMENT ON COLUMN meetings.last_edited_timestamp IS 'When the meeting was last edited';
COMMENT ON COLUMN meetings.last_edited_by IS 'Who last edited the meeting';
COMMENT ON COLUMN meetings.created_at IS 'When the meeting was created';
COMMENT ON COLUMN meetings.status IS 'Status of the meeting (scheduled, completed, cancelled, etc.)'; 