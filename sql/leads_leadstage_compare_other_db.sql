-- =============================================================================
-- Other-DB export vs local: MISSING rows only + optional INSERT backfill
-- =============================================================================
-- Goal: find rows that exist in the other database’s export but NOT in
--       public.leads_leadstage (by primary key id), then insert only those.
--
-- Do NOT run SELECT * FROM leads_leadstage WHERE stage = 60 — that lists
-- everything locally. Use the queries below instead.
--
-- LOAD EXPORT INTO STAGING (never into leads_leadstage):
--   sed 's/"public"."leads_leadstage"/"public"."leads_leadstage_other_db_export"/g' \
--     leads_leadstage_rows.sql > leads_leadstage_rows_staging.sql
--   psql "$DATABASE_URL" -f leads_leadstage_rows_staging.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.leads_leadstage_other_db_export (
  id bigint NOT NULL,
  cdate timestamptz,
  udate timestamptz,
  stage bigint,
  date timestamptz,
  creator_id bigint,
  lead_id bigint,
  CONSTRAINT leads_leadstage_other_db_export_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_leads_leadstage_other_export_lead_id
  ON public.leads_leadstage_other_db_export (lead_id)
  WHERE lead_id IS NOT NULL;


-- =============================================================================
-- A) How many rows WOULD be inserted (export rows whose id is not in leads_leadstage)
--     Run this first — small result only.
-- =============================================================================
SELECT count(*) AS rows_to_insert
FROM public.leads_leadstage_other_db_export e
WHERE NOT EXISTS (
  SELECT 1 FROM public.leads_leadstage l WHERE l.id = e.id
);


-- =============================================================================
-- B) ONLY missing rows (preview — same rows the INSERT will add)
--     Add LIMIT 100 for a sample if the list is huge
-- =============================================================================
SELECT
  e.id,
  e.lead_id,
  e.stage,
  e.date,
  e.cdate,
  e.udate,
  e.creator_id
FROM public.leads_leadstage_other_db_export e
WHERE NOT EXISTS (
  SELECT 1 FROM public.leads_leadstage l WHERE l.id = e.id
)
ORDER BY e.id;


-- =============================================================================
-- C) INSERT missing rows — COMMENTED OUT by default
--     After (A) matches your expectation and (B) looks correct: uncomment this block,
--     run it once, then comment it again.
--     If INSERT fails: remove newlead_id from the column list if your table has no
--     such column; fix FK errors if lead_id does not exist in leads_lead.
--     Restrict to stage 60 only if your export contains other stages (uncomment AND in SELECT).
-- =============================================================================
/*
BEGIN;

INSERT INTO public.leads_leadstage (
  id,
  cdate,
  udate,
  stage,
  date,
  creator_id,
  lead_id,
  newlead_id
)
SELECT
  e.id,
  e.cdate,
  e.udate,
  e.stage,
  e.date,
  e.creator_id,
  e.lead_id,
  NULL -- new leads use newlead_id; legacy exports use lead_id only
FROM public.leads_leadstage_other_db_export e
WHERE NOT EXISTS (
  SELECT 1 FROM public.leads_leadstage l WHERE l.id = e.id
)
-- AND e.stage = 60  -- uncomment if staging has non-60 rows you must skip
;

-- Keep id sequence past the highest id (so future inserts don’t collide)
SELECT setval(
  pg_get_serial_sequence('public.leads_leadstage', 'id'),
  COALESCE((SELECT max(id) FROM public.leads_leadstage), 1),
  true
);

COMMIT;
-- ROLLBACK; -- use instead of COMMIT if you need to undo
*/


-- =============================================================================
-- Optional: rows that exist ONLY locally (usually large — for audit only)
-- =============================================================================
/*
SELECT l.id, l.lead_id, l.newlead_id, l.stage, l.date, l.cdate
FROM public.leads_leadstage l
WHERE l.stage = 60
  AND NOT EXISTS (SELECT 1 FROM public.leads_leadstage_other_db_export e WHERE e.id = l.id)
ORDER BY l.id
LIMIT 500;
*/


-- =============================================================================
-- Cleanup staging when done
-- =============================================================================
-- DROP TABLE IF EXISTS public.leads_leadstage_other_db_export;
