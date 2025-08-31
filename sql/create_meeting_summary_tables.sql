-- Create meeting_transcripts table
CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'teams',
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  raw_transcript TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create meeting_summaries table
CREATE TABLE IF NOT EXISTS meeting_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  summary_he TEXT,
  summary_en TEXT,
  model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  tokens_used INTEGER DEFAULT 0,
  language_detected VARCHAR(10) DEFAULT 'en',
  action_items JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create meeting_questionnaires table
CREATE TABLE IF NOT EXISTS meeting_questionnaires (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  version VARCHAR(20) NOT NULL DEFAULT '1.0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns to existing meetings table
ALTER TABLE meetings 
ADD COLUMN IF NOT EXISTS teams_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS meeting_subject TEXT,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS transcript_url TEXT;

-- Add columns to existing leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS auto_email_meeting_summary BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS language_preference VARCHAR(10) DEFAULT 'en';

-- Add column to existing emails table
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS related_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_meeting_id ON meeting_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting_id ON meeting_summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_questionnaires_meeting_id ON meeting_questionnaires(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_teams_id ON meetings(teams_id);
CREATE INDEX IF NOT EXISTS idx_emails_related_meeting_id ON emails(related_meeting_id);

-- Create RLS policies
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_questionnaires ENABLE ROW LEVEL SECURITY;

-- RLS policies for meeting_transcripts
CREATE POLICY "Users can view meeting transcripts for their clients" ON meeting_transcripts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_transcripts.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can insert meeting transcripts" ON meeting_transcripts
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- RLS policies for meeting_summaries
CREATE POLICY "Users can view meeting summaries for their clients" ON meeting_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_summaries.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can insert meeting summaries" ON meeting_summaries
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- RLS policies for meeting_questionnaires
CREATE POLICY "Users can view meeting questionnaires for their clients" ON meeting_questionnaires
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_questionnaires.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can insert meeting questionnaires" ON meeting_questionnaires
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_meeting_transcripts_updated_at BEFORE UPDATE ON meeting_transcripts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meeting_summaries_updated_at BEFORE UPDATE ON meeting_summaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meeting_questionnaires_updated_at BEFORE UPDATE ON meeting_questionnaires
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
