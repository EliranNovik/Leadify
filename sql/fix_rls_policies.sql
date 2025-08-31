-- Fix RLS policies to allow authenticated users to insert data
-- Run this in your Supabase SQL Editor

-- Drop existing insert policies
DROP POLICY IF EXISTS "Service role can insert meeting transcripts" ON meeting_transcripts;
DROP POLICY IF EXISTS "Service role can insert meeting summaries" ON meeting_summaries;
DROP POLICY IF EXISTS "Service role can insert meeting questionnaires" ON meeting_questionnaires;

-- Create new insert policies that allow authenticated users
CREATE POLICY "Authenticated users can insert meeting transcripts" ON meeting_transcripts
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_transcripts.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Authenticated users can insert meeting summaries" ON meeting_summaries
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_summaries.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Authenticated users can insert meeting questionnaires" ON meeting_questionnaires
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN leads l ON m.client_id = l.id
      WHERE m.id = meeting_questionnaires.meeting_id
      AND l.manager = auth.jwt() ->> 'email'
    )
  );

-- Also add service role policies for edge functions
CREATE POLICY "Service role can insert meeting transcripts" ON meeting_transcripts
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert meeting summaries" ON meeting_summaries
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert meeting questionnaires" ON meeting_questionnaires
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- For testing purposes, also add a policy that allows any authenticated user to insert
-- (This is less secure but useful for testing)
CREATE POLICY "Test: Any authenticated user can insert" ON meeting_transcripts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Test: Any authenticated user can insert" ON meeting_summaries
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Test: Any authenticated user can insert" ON meeting_questionnaires
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

SELECT 'RLS policies updated successfully!' as status;
