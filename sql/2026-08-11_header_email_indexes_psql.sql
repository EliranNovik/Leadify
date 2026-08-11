-- =============================================================================
-- STEP 2: btree indexes on emails — MUST use psql (not SQL editor)
-- =============================================================================
-- Why: CREATE INDEX on a large emails table exceeds the SQL editor HTTP timeout
-- even with SET statement_timeout TO '0'.
--
-- 1) Supabase Dashboard → Project Settings → Database → Connection string (URI)
--    Use the "Direct connection" (port 5432), not the pooler.
-- 2) From your machine:
--
--    export DATABASE_URL='postgresql://postgres.…@db.…supabase.co:5432/postgres'
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-11_header_email_indexes_psql.sql
--
-- CONCURRENTLY cannot run inside a transaction block. This file is written so
-- each statement auto-commits when run via psql (no wrapping BEGIN).
-- =============================================================================

SET statement_timeout TO '0';

-- Drop INVALID leftovers from editor timeouts (safe if none exist)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS index_name
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND NOT i.indisvalid
      AND c.relname LIKE 'idx_emails_%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
    RAISE NOTICE 'Dropped invalid index %', r.index_name;
  END LOOP;
END $$;

-- Build without blocking writes (run outside a transaction — default in psql)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_incoming_sent_at
ON public.emails (sent_at DESC)
WHERE direction = 'incoming';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_incoming_unread_sent_at
ON public.emails (sent_at DESC)
WHERE direction = 'incoming'
  AND COALESCE(is_read, false) = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_office_inbox_unread_sent_at
ON public.emails (sent_at DESC)
WHERE direction = 'incoming'
  AND COALESCE(is_read, false) = false
  AND recipient_list ILIKE '%office@lawoffice.org.il%';

-- Verify
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'emails'
  AND indexname LIKE 'idx_emails_%'
ORDER BY indexname;

SELECT c.relname AS index_name, i.indisvalid AS is_valid
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'idx_emails_%'
ORDER BY 1;
