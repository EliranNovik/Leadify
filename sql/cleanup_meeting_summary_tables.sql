-- Cleanup script for meeting summary tables
-- WARNING: This will delete all meeting summary data!
-- Only run this if you want to start completely fresh

-- Drop triggers first
DROP TRIGGER IF EXISTS update_meeting_transcripts_updated_at ON meeting_transcripts;
DROP TRIGGER IF EXISTS update_meeting_summaries_updated_at ON meeting_summaries;
DROP TRIGGER IF EXISTS update_meeting_questionnaires_updated_at ON meeting_questionnaires;

-- Drop policies
DROP POLICY IF EXISTS "Users can view meeting transcripts for their clients" ON meeting_transcripts;
DROP POLICY IF EXISTS "Service role can insert meeting transcripts" ON meeting_transcripts;

DROP POLICY IF EXISTS "Users can view meeting summaries for their clients" ON meeting_summaries;
DROP POLICY IF EXISTS "Service role can insert meeting summaries" ON meeting_summaries;

DROP POLICY IF EXISTS "Users can view meeting questionnaires for their clients" ON meeting_questionnaires;
DROP POLICY IF EXISTS "Service role can insert meeting questionnaires" ON meeting_questionnaires;

-- Drop tables (in correct order due to foreign key constraints)
DROP TABLE IF EXISTS meeting_questionnaires;
DROP TABLE IF EXISTS meeting_summaries;
DROP TABLE IF EXISTS meeting_transcripts;

-- Drop indexes
DROP INDEX IF EXISTS idx_meeting_transcripts_meeting_id;
DROP INDEX IF EXISTS idx_meeting_summaries_meeting_id;
DROP INDEX IF EXISTS idx_meeting_questionnaires_meeting_id;
DROP INDEX IF EXISTS idx_meetings_teams_id;
DROP INDEX IF EXISTS idx_emails_related_meeting_id;

-- Remove columns from existing tables
ALTER TABLE meetings 
DROP COLUMN IF EXISTS teams_id,
DROP COLUMN IF EXISTS meeting_subject,
DROP COLUMN IF EXISTS started_at,
DROP COLUMN IF EXISTS ended_at,
DROP COLUMN IF EXISTS transcript_url;

ALTER TABLE leads 
DROP COLUMN IF EXISTS auto_email_meeting_summary,
DROP COLUMN IF EXISTS language_preference;

ALTER TABLE emails 
DROP COLUMN IF EXISTS related_meeting_id;

-- Drop the function (only if no other tables use it)
-- DROP FUNCTION IF EXISTS update_updated_at_column();

SELECT 'Cleanup completed successfully!' as status;
