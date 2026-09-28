-- Optional companion to sql/2026-09-28_stage_eval_cpu_fix.sql.
--
-- Run this ONLY if the report below shows a column with no index. Each statement uses
-- CONCURRENTLY, so run them ONE AT A TIME and NOT inside a transaction block
-- (the Supabase SQL editor runs a single statement without a wrapping transaction).
--
-- Step 1 — report which of the hot columns already have a usable leading-column index:
SELECT
  c.relname  AS table_name,
  a.attname  AS column_name,
  COALESCE(
    string_agg(i.relname, ', ' ORDER BY i.relname),
    '*** NO INDEX — create it below ***'
  ) AS existing_indexes
FROM (VALUES
  ('call_logs', 'lead_id'),
  ('leads_leadinteractions', 'lead_id'),
  ('whatsapp_messages', 'legacy_id'),
  ('whatsapp_messages', 'lead_id'),
  ('emails', 'legacy_id'),
  ('emails', 'client_id')
) AS want(tbl, col)
JOIN pg_class c ON c.relname = want.tbl AND c.relnamespace = 'public'::regnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = want.col AND a.attnum > 0
LEFT JOIN pg_index x ON x.indrelid = c.oid AND x.indkey[0] = a.attnum
LEFT JOIN pg_class i ON i.oid = x.indexrelid
GROUP BY c.relname, a.attname
ORDER BY c.relname, a.attname;


-- Step 2 — create only the missing ones, one statement at a time.
-- CREATE INDEX CONCURRENTLY does not block reads or writes.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_logs_lead_id
--   ON public.call_logs (lead_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_leadinteractions_lead_id
--   ON public.leads_leadinteractions (lead_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_messages_legacy_id
--   ON public.whatsapp_messages (legacy_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_messages_lead_id
--   ON public.whatsapp_messages (lead_id);
