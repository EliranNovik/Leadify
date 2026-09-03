-- Isolated web-search audit trail. The search model never sees these rows.

CREATE TABLE IF NOT EXISTS rmq_ai_web_search_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id TEXT,
  sanitized_query TEXT NOT NULL,
  reason TEXT,
  category TEXT,
  requested_domains TEXT[] DEFAULT '{}',
  effective_domains TEXT[] DEFAULT '{}',
  pii_result TEXT NOT NULL CHECK (pii_result IN ('allow', 'reject')),
  pii_reason TEXT,
  source_urls TEXT[] DEFAULT '{}',
  source_count INTEGER DEFAULT 0,
  search_count INTEGER DEFAULT 0,
  confidence TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rmq_ai_web_search_log_user_created_idx
  ON rmq_ai_web_search_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rmq_ai_web_search_log_created_idx
  ON rmq_ai_web_search_log (created_at DESC);

ALTER TABLE rmq_ai_web_search_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY rmq_ai_web_search_log_own_read
    ON rmq_ai_web_search_log
    FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
