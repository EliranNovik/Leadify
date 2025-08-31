-- Create table for Teams meetings created through Outlook Calendar page
CREATE TABLE IF NOT EXISTS outlook_teams_meetings (
    id SERIAL PRIMARY KEY,
    teams_meeting_id VARCHAR(255) UNIQUE, -- Microsoft Graph meeting ID
    subject VARCHAR(500) NOT NULL,
    start_date_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date_time TIMESTAMP WITH TIME ZONE NOT NULL,
    teams_join_url TEXT, -- The actual Teams join URL
    teams_meeting_url TEXT, -- Alternative URL field
    calendar_id VARCHAR(255) NOT NULL, -- Which calendar it was created in (e.g., shared-staffcalendar@lawoffice.org.il)
    attendees JSONB, -- Store attendees as JSON array
    description TEXT,
    location VARCHAR(500),
    created_by VARCHAR(255) NOT NULL, -- User who created the meeting
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, completed, cancelled
    is_online_meeting BOOLEAN DEFAULT TRUE,
    online_meeting_provider VARCHAR(100) DEFAULT 'teamsForBusiness'
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_outlook_teams_meetings_calendar_id ON outlook_teams_meetings(calendar_id);
CREATE INDEX IF NOT EXISTS idx_outlook_teams_meetings_start_date ON outlook_teams_meetings(start_date_time);
CREATE INDEX IF NOT EXISTS idx_outlook_teams_meetings_created_by ON outlook_teams_meetings(created_by);
CREATE INDEX IF NOT EXISTS idx_outlook_teams_meetings_teams_id ON outlook_teams_meetings(teams_meeting_id);

-- Add RLS (Row Level Security) policies
ALTER TABLE outlook_teams_meetings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all Teams meetings (for calendar display)
CREATE POLICY "Users can view outlook teams meetings" ON outlook_teams_meetings
    FOR SELECT USING (true);

-- Policy: Users can insert their own Teams meetings
CREATE POLICY "Users can insert outlook teams meetings" ON outlook_teams_meetings
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = created_by);

-- Policy: Users can update their own Teams meetings
CREATE POLICY "Users can update outlook teams meetings" ON outlook_teams_meetings
    FOR UPDATE USING (auth.jwt() ->> 'email' = created_by);

-- Policy: Service role can do everything
CREATE POLICY "Service role can manage outlook teams meetings" ON outlook_teams_meetings
    FOR ALL USING (auth.role() = 'service_role');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_outlook_teams_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_outlook_teams_meetings_updated_at
    BEFORE UPDATE ON outlook_teams_meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_outlook_teams_meetings_updated_at();

-- Add some helpful comments
COMMENT ON TABLE outlook_teams_meetings IS 'Stores Teams meetings created through the Outlook Calendar page';
COMMENT ON COLUMN outlook_teams_meetings.teams_meeting_id IS 'Microsoft Graph API meeting ID';
COMMENT ON COLUMN outlook_teams_meetings.teams_join_url IS 'Direct Teams join URL for the meeting';
COMMENT ON COLUMN outlook_teams_meetings.calendar_id IS 'Email of the calendar where meeting was created';
COMMENT ON COLUMN outlook_teams_meetings.attendees IS 'JSON array of attendee email addresses';
