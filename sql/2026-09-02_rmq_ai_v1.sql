-- RMQ AI v1: recall search, observe, memory, knowledge, quality, recommendations.

CREATE OR REPLACE FUNCTION search_my_past_chats(
  p_query TEXT DEFAULT '',
  p_lead_id UUID DEFAULT NULL,
  p_lead_number TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  title VARCHAR(255),
  summary TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  lead_id UUID,
  lead_number TEXT,
  matching_snippet TEXT,
  match_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ach.id,
    ach.title::VARCHAR(255),
    ach.summary,
    ach.updated_at,
    ach.created_at,
    ach.lead_id,
    COALESCE(p_lead_number, '')::TEXT,
    LEFT(COALESCE(ach.summary, ach.title, ''), 180),
    CASE
      WHEN p_lead_id IS NOT NULL AND ach.lead_id = p_lead_id THEN 'lead'
      WHEN p_lead_number IS NOT NULL AND (
        ach.summary ILIKE '%' || p_lead_number || '%'
        OR ach.title ILIKE '%' || p_lead_number || '%'
        OR p_lead_number = ANY(ach.tags)
      ) THEN 'lead'
      WHEN p_query <> '' AND ach.title ILIKE '%' || p_query || '%' THEN 'title'
      WHEN p_query <> '' AND ach.summary ILIKE '%' || p_query || '%' THEN 'summary'
      ELSE 'message'
    END
  FROM ai_chat_history ach
  WHERE ach.user_id = auth.uid()
    AND ach.is_archived = FALSE
    AND (
      (p_lead_id IS NOT NULL AND ach.lead_id = p_lead_id)
      OR (p_lead_number IS NOT NULL AND (
        ach.summary ILIKE '%' || p_lead_number || '%'
        OR ach.title ILIKE '%' || p_lead_number || '%'
        OR p_lead_number = ANY(ach.tags)
      ))
      OR (p_query <> '' AND (
        ach.title ILIKE '%' || p_query || '%'
        OR ach.summary ILIKE '%' || p_query || '%'
        OR p_query = ANY(ach.tags)
        OR ach.messages::text ILIKE '%' || p_query || '%'
      ))
    )
  ORDER BY
    CASE WHEN p_lead_id IS NOT NULL AND ach.lead_id = p_lead_id THEN 0 ELSE 1 END,
    ach.updated_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 12));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_ai_chat_summary(
  p_chat_id UUID,
  p_summary TEXT,
  p_tags TEXT[] DEFAULT '{}',
  p_lead_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_chat_history
  SET
    summary = p_summary,
    tags = COALESCE(p_tags, '{}'),
    lead_id = COALESCE(p_lead_id, lead_id),
    updated_at = NOW()
  WHERE id = p_chat_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID,
  message_id TEXT,
  rating TEXT CHECK (rating IN ('up', 'down')),
  reason TEXT,
  correction TEXT,
  failure_origin TEXT,
  ai_trace_id TEXT,
  versions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_quality_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_trace_id TEXT,
  conversation_id UUID,
  message_id TEXT,
  event_name TEXT NOT NULL,
  versions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_answer_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_trace_id TEXT,
  answer_message_id TEXT NOT NULL,
  claims JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fact TEXT NOT NULL,
  category TEXT NOT NULL,
  source_type TEXT,
  source_conversation_id UUID,
  source_message_id TEXT,
  confidence NUMERIC DEFAULT 0.6,
  evidence_count INTEGER DEFAULT 1,
  durability TEXT DEFAULT 'long_term',
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  supersedes_memory_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_firm_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact TEXT NOT NULL,
  category TEXT,
  source_type TEXT DEFAULT 'admin',
  confidence NUMERIC DEFAULT 0.6,
  evidence_count INTEGER DEFAULT 1,
  durability TEXT DEFAULT 'permanent',
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT FALSE,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_firm_lesson_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact TEXT NOT NULL,
  evidence_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'edited')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('firm', 'user')),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded')),
  owner TEXT,
  version TEXT DEFAULT '1',
  effective_from TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES ai_knowledge_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_content ON ai_knowledge_chunks USING gin(to_tsvector('english', content));

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
    CASE WHEN f.scope = 'firm' THEN 0 ELSE 1 END,
    f.reviewed_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 12));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS ai_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_trace_id TEXT,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID,
  ai_trace_id TEXT,
  action_type TEXT,
  reason TEXT,
  executable BOOLEAN DEFAULT FALSE,
  outcome TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_eval_cases (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  payload JSONB NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quality_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_answer_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_firm_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_firm_lesson_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_eval_cases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY ai_feedback_own ON ai_feedback FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_quality_own ON ai_quality_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_evidence_own ON ai_answer_evidence FOR ALL USING (auth.uid() = user_id) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_user_memory_own ON ai_user_memory FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_memory_read ON ai_firm_memory FOR SELECT USING (active = TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_read ON ai_knowledge_files FOR SELECT
    USING (scope = 'firm' OR user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_write ON ai_knowledge_files FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_update ON ai_knowledge_files
    FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_delete ON ai_knowledge_files
    FOR DELETE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_chunks_read ON ai_knowledge_chunks FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_chunks_write ON ai_knowledge_chunks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_recommendations_own ON ai_recommendations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_incidents_own ON ai_incidents FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_incidents_insert ON ai_incidents FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_read ON ai_firm_lesson_candidates FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_insert ON ai_firm_lesson_candidates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_update ON ai_firm_lesson_candidates FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_memory_insert ON ai_firm_memory FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_memory_update ON ai_firm_memory FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
