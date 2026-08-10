-- Speeds up Header unread email badge / inbox polls (avoids statement timeout 57014).
--
-- Supabase SQL editor wraps statements in a transaction, so CONCURRENTLY cannot be used there.
-- This version is editor-safe. Disable timeout first so a large table build can finish.
--
-- If the editor still hits an upstream gateway timeout, run the same two statements via
-- psql / any direct Postgres client instead:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET statement_timeout TO '0'; CREATE INDEX IF NOT EXISTS idx_emails_incoming_unread_sent_at ON public.emails (sent_at DESC) WHERE direction = 'incoming' AND (is_read IS NULL OR is_read = false);"
--
-- Optional (direct client only — not SQL editor): create without locking writes:
--   SET statement_timeout TO '0';
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_incoming_unread_sent_at
--   ON public.emails (sent_at DESC)
--   WHERE direction = 'incoming' AND (is_read IS NULL OR is_read = false);

SET statement_timeout TO '0';

CREATE INDEX IF NOT EXISTS idx_emails_incoming_unread_sent_at
ON public.emails (sent_at DESC)
WHERE direction = 'incoming'
  AND (is_read IS NULL OR is_read = false);
