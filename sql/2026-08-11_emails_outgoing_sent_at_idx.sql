-- Partial index so outgoing thread scans don't filter millions of incoming rows.
-- Run via psql (session pooler). CONCURRENTLY cannot run inside a transaction.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-11_emails_outgoing_sent_at_idx.sql

SET statement_timeout TO '0';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_emails_outgoing_sent_at'
  ) THEN
    RAISE NOTICE 'idx_emails_outgoing_sent_at already exists — skipping';
  ELSE
    CREATE INDEX idx_emails_outgoing_sent_at
      ON public.emails (sent_at DESC)
      WHERE direction = 'outgoing';
    RAISE NOTICE 'created idx_emails_outgoing_sent_at';
  END IF;
END
$$;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'emails'
  AND indexname = 'idx_emails_outgoing_sent_at';
