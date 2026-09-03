-- Verified firm knowledge provenance + research feedback (eval queue, not auto-learning).

ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS knowledge_kind TEXT DEFAULT 'fact';
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS topic_scope TEXT DEFAULT 'global';
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS authority TEXT;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS case_type TEXT;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS review_after TIMESTAMPTZ;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS superseded_by UUID;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS source_urls JSONB DEFAULT '[]';
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS source_authority TEXT;
ALTER TABLE ai_knowledge_files ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'upload';

CREATE TABLE IF NOT EXISTS rmq_ai_research_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id UUID,
  message_id TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('useful', 'wrong')),
  summary TEXT,
  source_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rmq_ai_research_feedback_created_idx
  ON rmq_ai_research_feedback (created_at DESC);

ALTER TABLE rmq_ai_research_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY rmq_ai_research_feedback_own
    ON rmq_ai_research_feedback
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION search_firm_knowledge(p_query TEXT, p_limit INTEGER DEFAULT 6)
RETURNS TABLE (
  title TEXT,
  content TEXT,
  document_version TEXT,
  chunk_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.title,
    LEFT(c.content, 800),
    f.version,
    c.id
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_files f ON f.id = c.file_id
  WHERE f.status IN ('approved', 'draft')
    AND (f.expires_at IS NULL OR f.expires_at > NOW())
    AND (
      f.scope = 'firm'
      OR (f.scope = 'user' AND f.user_id = auth.uid())
    )
    AND (
      c.content ILIKE '%' || p_query || '%'
      OR f.title ILIKE '%' || p_query || '%'
    )
  ORDER BY
    CASE WHEN f.status = 'approved' THEN 0 ELSE 1 END,
    CASE WHEN f.review_after IS NULL OR f.review_after > NOW() THEN 0 ELSE 1 END,
    CASE WHEN f.scope = 'firm' THEN 0 ELSE 1 END,
    f.reviewed_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 12));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
