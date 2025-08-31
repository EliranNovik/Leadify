-- Simple RLS fix - Drop all existing policies and create new ones
-- Run this in your Supabase SQL Editor

-- Drop ALL existing policies for these tables
DROP POLICY IF EXISTS "Users can view meeting transcripts for their clients" ON meeting_transcripts;
DROP POLICY IF EXISTS "Service role can insert meeting transcripts" ON meeting_transcripts;
DROP POLICY IF EXISTS "Authenticated users can insert meeting transcripts" ON meeting_transcripts;
DROP POLICY IF EXISTS "Test: Any authenticated user can insert" ON meeting_transcripts;

DROP POLICY IF EXISTS "Users can view meeting summaries for their clients" ON meeting_summaries;
DROP POLICY IF EXISTS "Service role can insert meeting summaries" ON meeting_summaries;
DROP POLICY IF EXISTS "Authenticated users can insert meeting summaries" ON meeting_summaries;
DROP POLICY IF EXISTS "Test: Any authenticated user can insert" ON meeting_summaries;

DROP POLICY IF EXISTS "Users can view meeting questionnaires for their clients" ON meeting_questionnaires;
DROP POLICY IF EXISTS "Service role can insert meeting questionnaires" ON meeting_questionnaires;
DROP POLICY IF EXISTS "Authenticated users can insert meeting questionnaires" ON meeting_questionnaires;
DROP POLICY IF EXISTS "Test: Any authenticated user can insert" ON meeting_questionnaires;

-- Create simple policies for testing
-- Allow any authenticated user to insert (for testing)
CREATE POLICY "Allow authenticated insert" ON meeting_transcripts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated insert" ON meeting_summaries
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated insert" ON meeting_questionnaires
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow any authenticated user to select (for testing)
CREATE POLICY "Allow authenticated select" ON meeting_transcripts
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated select" ON meeting_summaries
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated select" ON meeting_questionnaires
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow service role for edge functions
CREATE POLICY "Service role access" ON meeting_transcripts
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON meeting_summaries
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON meeting_questionnaires
  FOR ALL USING (auth.role() = 'service_role');

SELECT 'Simple RLS policies created successfully!' as status;
