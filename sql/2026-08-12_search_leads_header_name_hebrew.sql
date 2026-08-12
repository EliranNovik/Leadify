-- Patch: Header name/Hebrew search (run after or instead of full 2026-08-11_search_leads_header_rpc.sql).
-- Fixes slow/failing client + contact name search, especially Hebrew last names.
-- Safe to re-run.
--
-- Run in Supabase SQL editor OR:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-12_search_leads_header_name_hebrew.sql

SET statement_timeout TO '0';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_leads_name_lower_trgm
  ON public.leads USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';

CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower_trgm
  ON public.leads_lead USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';

CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower_trgm
  ON public.leads_contact USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';

-- Re-apply full RPC from the main file (includes NAME branch + 4s timeout).
-- Prefer running the full updated file so email/phone/lead branches stay in sync:
--   sql/2026-08-11_search_leads_header_rpc.sql

NOTIFY pgrst, 'reload schema';
