-- =============================================================================
-- Fix: lead_number ILIKE 'prefix%' on LEADS table using an index (no Seq Scan)
-- =============================================================================
-- Your EXPLAIN showed: "Seq Scan on leads" with "Filter: (lead_number ~~* '12345%')"
-- Plain btree on lead_number is not used for ILIKE. This index (text_pattern_ops)
-- allows PostgreSQL to use an index for ILIKE 'prefix%' and LIKE 'prefix%'.
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_lead_number_pattern
  ON public.leads (lead_number text_pattern_ops);

-- Optional: same for email and name (Header search by email/name)
CREATE INDEX IF NOT EXISTS idx_leads_email_pattern
  ON public.leads (email text_pattern_ops)
  WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS idx_leads_name_pattern
  ON public.leads (name text_pattern_ops)
  WHERE name IS NOT NULL AND name <> '';
