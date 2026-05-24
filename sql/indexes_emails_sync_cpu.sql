-- =============================================================================
-- Email sync CPU optimization indexes
-- =============================================================================
-- Run in Supabase SQL Editor after deploying graphMailboxSyncService changes.
-- Targets hot paths from pg_stat_statements: message_id lookups/updates and
-- body hydration (body_cached = false).
-- Safe to run multiple times (IF NOT EXISTS).
-- =============================================================================

-- Fast UPDATE ... WHERE message_id = $1 AND body_cached IS NOT TRUE
CREATE INDEX IF NOT EXISTS idx_emails_message_id_uncached
  ON public.emails (message_id)
  WHERE message_id IS NOT NULL AND (body_cached IS NOT TRUE);

-- Composite key used for dedupe checks (message_id + lead/contact dimensions)
CREATE INDEX IF NOT EXISTS idx_emails_message_lead_keys
  ON public.emails (message_id, client_id, legacy_id, contact_id)
  WHERE message_id IS NOT NULL;

-- Contact-scoped timeline reads (InteractionsTab)
CREATE INDEX IF NOT EXISTS idx_emails_contact_id_sent_at
  ON public.emails (contact_id, sent_at DESC)
  WHERE contact_id IS NOT NULL;

-- Calendar: leads_lead by meeting_date (heavy join query in reports/calendar)
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_date
  ON public.leads_lead (meeting_date)
  WHERE meeting_date IS NOT NULL AND name IS NOT NULL;

-- Scheduler polling: leads by stage where not unactivated
CREATE INDEX IF NOT EXISTS idx_leads_stage_unactivated
  ON public.leads (stage)
  WHERE unactivated_at IS NULL;

-- leads_leadinteractions kind filter
CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_kind
  ON public.leads_leadinteractions (kind)
  WHERE lead_id IS NOT NULL;
