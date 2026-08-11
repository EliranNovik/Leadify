-- Speeds InteractionsTab / email modal address fallback:
--   WHERE sender_email = $1 AND sent_at >= $2 ORDER BY sent_at DESC
--
-- Do NOT run CREATE INDEX on emails in the Supabase SQL editor — the HTTP
-- gateway times out even with SET statement_timeout TO '0'.
--
-- Run via psql (session pooler port 5432 works; direct db.* may be refused):
--
--   export DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?gssencmode=disable&sslmode=require'
--   # URL-encode special chars in password (e.g. ! → %21)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-11_emails_sender_email_sent_at_idx.sql

SET statement_timeout TO '0';

-- Drop INVALID leftovers from editor timeouts
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
      AND c.relname = 'idx_emails_sender_email_sent_at'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
    RAISE NOTICE 'Dropped invalid index %', r.index_name;
  END LOOP;
END $$;

-- Skip if already present (avoids rare 23505 races in the SQL editor).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_emails_sender_email_sent_at'
      AND c.relkind = 'i'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX idx_emails_sender_email_sent_at
        ON public.emails (sender_email, sent_at DESC)
        WHERE sender_email IS NOT NULL AND btrim(sender_email) <> ''
    $idx$;
  ELSE
    RAISE NOTICE 'idx_emails_sender_email_sent_at already exists — skipping';
  END IF;
END $$;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'emails'
  AND indexname = 'idx_emails_sender_email_sent_at';
