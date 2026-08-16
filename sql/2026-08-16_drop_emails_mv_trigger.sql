-- Optional. Only after sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql.
-- Pause the backend (stop mailbox sync) first, then run this alone.
-- DROP TRIGGER needs AccessExclusiveLock on public.emails and will deadlock
-- if Graph sync is inserting at the same time.

SET lock_timeout = '5s';
SET statement_timeout = '15s';

DROP TRIGGER IF EXISTS trigger_emails_refresh ON public.emails;
