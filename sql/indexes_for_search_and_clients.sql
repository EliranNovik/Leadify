-- =============================================================================
-- Indexes for Search + Clients / ClientHeader performance
-- =============================================================================
-- Used by: Header.tsx search bar, legacyLeadsApi.ts, Clients.tsx, ClientHeader.tsx
-- Run this in Supabase SQL Editor (or psql) to ensure these indexes exist.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- How to check existing indexes in the DB (see bottom of file).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LEADS (new leads table)
-- -----------------------------------------------------------------------------
-- Search: lead_number (eq + ilike prefix), email (ilike prefix), name (ilike prefix)
-- List: order by created_at DESC, fetch by id
-- text_pattern_ops allows index use for ILIKE 'prefix%' and LIKE 'prefix%'

CREATE INDEX IF NOT EXISTS idx_leads_lead_number_pattern
  ON public.leads (lead_number text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_leads_email_pattern
  ON public.leads (email text_pattern_ops)
  WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS idx_leads_name_pattern
  ON public.leads (name text_pattern_ops)
  WHERE name IS NOT NULL AND name <> '';

-- created_at for fetchLatestLead / fetchAllLeads: use idx_leads_created_at from optimize_pipeline_performance.sql

-- -----------------------------------------------------------------------------
-- 2. LEADS_LEAD (legacy leads table)
-- -----------------------------------------------------------------------------
-- Search: lead_number (eq + ilike prefix), master_id for subleads
-- List: order by cdate DESC, order by id

-- lead_number may be bigint: use expression index so ILIKE on cast uses index; no <> '' (invalid for bigint)
CREATE INDEX IF NOT EXISTS idx_leads_lead_lead_number_pattern
  ON public.leads_lead ((lead_number::text) text_pattern_ops)
  WHERE lead_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_master_id
  ON public.leads_lead (master_id)
  WHERE master_id IS NOT NULL;

-- cdate for fetchLatestLead / fetchAllLeads: use idx_leads_lead_cdate from optimize_pipeline_performance.sql

-- -----------------------------------------------------------------------------
-- 3. LEADS_CONTACT
-- -----------------------------------------------------------------------------
-- Search: email (ilike), name (ilike) – optimize_contact_search_indexes has lower(name/email)
-- Lookup by newlead_id (optimize_contact_search_indexes has idx_leads_contact_newlead_id)
-- text_pattern_ops for ILIKE prefix/contains where applicable

CREATE INDEX IF NOT EXISTS idx_leads_contact_email_pattern
  ON public.leads_contact (email text_pattern_ops)
  WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS idx_leads_contact_name_pattern
  ON public.leads_contact (name text_pattern_ops)
  WHERE name IS NOT NULL AND name <> '';

-- -----------------------------------------------------------------------------
-- 4. LEAD_LEADCONTACT (junction: contact <-> lead) – search + contacts logic
-- -----------------------------------------------------------------------------
-- legacyLeadsApi: .in('newlead_id', ids), .in('lead_id', ids), .in('contact_id', ids)
-- Contacts logic: FinancesTab, ClientInformationBox, CasesTab, InteractionsTab,
-- WhatsAppPage, HandlerManagementPage, masterLeadApi, etc.
-- optimize_junction_table_indexes.sql may already have (newlead_id, main), (lead_id, main),
-- (contact_id, lead_id, newlead_id). Below: single-column + composite for contact lookups.

-- Single-column: WHERE newlead_id IN (...) / eq, WHERE lead_id IN (...) / eq, WHERE contact_id IN (...)
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_newlead_id
  ON public.lead_leadcontact (newlead_id)
  WHERE newlead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_id
  ON public.lead_leadcontact (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_id
  ON public.lead_leadcontact (contact_id);

-- Composite: lookups by (lead_id, contact_id) – e.g. InteractionsTab, ClientInformationBox
-- "get lead_leadcontact row for this legacy lead + contact"
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_id_contact_id
  ON public.lead_leadcontact (lead_id, contact_id)
  WHERE lead_id IS NOT NULL AND contact_id IS NOT NULL;

-- Composite: lookups by (newlead_id, contact_id) – "get row for this new lead + contact"
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_newlead_id_contact_id
  ON public.lead_leadcontact (newlead_id, contact_id)
  WHERE newlead_id IS NOT NULL AND contact_id IS NOT NULL;

-- Composite: lookups by (contact_id, lead_id) – when resolving from contact first (e.g. legacyLeadsApi junction)
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_id_lead_id
  ON public.lead_leadcontact (contact_id, lead_id)
  WHERE contact_id IS NOT NULL;

-- (lead_id, main) and (newlead_id, main): use idx_lead_leadcontact_lead_main / idx_lead_leadcontact_newlead_main from optimize_junction_table_indexes.sql if present.

-- =============================================================================
-- HOW TO CHECK INDEXES IN THE DATABASE
-- =============================================================================
-- Run these in Supabase SQL Editor (or psql) to inspect indexes.
--
-- 1) List all indexes for the tables used by search and clients:
--
--    SELECT schemaname, tablename, indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename IN ('leads', 'leads_lead', 'leads_contact', 'lead_leadcontact')
--    ORDER BY tablename, indexname;
--
-- 2) Check if a specific index exists:
--
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename = 'leads' AND indexname LIKE 'idx_leads%';
--
-- 3) See which index was used for a query (run EXPLAIN ANALYZE in SQL Editor):
--
--    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
--    SELECT id, lead_number, name, email FROM leads
--    WHERE lead_number ILIKE '12345%' LIMIT 25;
--
--    Junction (contacts logic) example:
--    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
--    SELECT contact_id, newlead_id, lead_id, main FROM lead_leadcontact
--    WHERE lead_id IN (12345, 12346) LIMIT 150;
--
--    Look for "Index Scan" or "Index Only Scan" on the index you expect.
--    "Seq Scan" means the table was scanned without using an index.
--
-- 4) Table sizes and index sizes:
--
--    SELECT
--      relname AS table_name,
--      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
--      pg_size_pretty(pg_relation_size(relid)) AS table_size,
--      pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_size
--    FROM pg_catalog.pg_statio_user_tables
--    WHERE relname IN ('leads', 'leads_lead', 'leads_contact', 'lead_leadcontact')
--    ORDER BY pg_total_relation_size(relid) DESC;
