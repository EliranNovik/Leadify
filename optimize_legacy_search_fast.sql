-- Fast Legacy Lead Search Optimization
-- This creates lightweight indexes optimized for fast search queries

-- 1. Remove heavy indexes that slow down writes (if they exist)
DROP INDEX IF EXISTS idx_leads_lead_name_gin;
DROP INDEX IF EXISTS idx_leads_lead_topic_gin;
DROP INDEX IF EXISTS idx_leads_lead_name_hebrew;
DROP INDEX IF EXISTS idx_leads_lead_topic_hebrew;

-- 2. Create lightweight B-tree indexes for exact/prefix matches (MUCH faster than GIN for exact searches)
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_btree ON leads_lead (name text_pattern_ops) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_btree ON leads_lead (topic text_pattern_ops) WHERE topic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_email_btree ON leads_lead (email text_pattern_ops) WHERE email IS NOT NULL;

-- 3. Phone number indexes (already have these, but ensure they exist)
CREATE INDEX IF NOT EXISTS idx_leads_lead_phone ON leads_lead (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile ON leads_lead (mobile) WHERE mobile IS NOT NULL;

-- 4. ID is primary key (already indexed, fastest possible)
-- No additional index needed for id/lead_number since id is the lead_number in leads_lead

-- Note: text_pattern_ops indexes are optimized for LIKE/ILIKE queries starting with the pattern
-- They're much faster than GIN indexes for prefix searches and don't slow down writes as much
