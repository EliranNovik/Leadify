-- Optional follow-up to sql/2026-09-28_stage_eval_cpu_fix.sql.
--
-- sync_lookup_addresses (sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql) joins on
--   lower(btrim(l.email)) / lower(btrim(ll.email)) / lower(btrim(c.email))
-- but the only existing expression indexes are on lower(email):
--   idx_leads_email_lower, idx_leads_lead_email_lower, idx_leads_contact_email_lower
-- Postgres only uses an expression index when the expression matches exactly, so the extra
-- btrim() makes all three joins sequential scans. That is why the RPC costs the same for 2,
-- 20 or 100 addresses (measured: 460-514 ms in every case; an index lookup would scale with
-- the number of addresses instead of staying flat).
--
-- These indexes match the expression the function actually uses, so no function change and
-- no behaviour change is needed: emails stored with surrounding whitespace keep matching.
--
-- Run each statement ON ITS OWN and NOT inside a transaction block: CREATE INDEX CONCURRENTLY
-- cannot run in a transaction. It does not block reads or writes.
-- Safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_email_lower_btrim
  ON public.leads (lower(btrim(email)));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_lead_email_lower_btrim
  ON public.leads_lead (lower(btrim(email)));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_contact_email_lower_btrim
  ON public.leads_contact (lower(btrim(email)));

-- After the three indexes exist, refresh planner statistics for them:
ANALYZE public.leads;
ANALYZE public.leads_lead;
ANALYZE public.leads_contact;
