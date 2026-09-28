-- Diagnose the 57014 statement timeout on
--   GET /rest/v1/leads?select=*,emails(*),...&id=eq.<uuid>
-- raised by refreshClientData() in src/App.tsx (the `emails (*)` embed).
--
-- Read-only. Run SECTION 1 and SECTION 2 separately: the Supabase SQL editor only
-- returns the result of the last statement in a batch.
--
-- Hypotheses being tested:
--   V) emails.client_id has no usable index, so the embed sequential-scans ~12.2M rows.
--   W) An index exists, but `emails(*)` pulls body_html for hundreds of rows and the
--      cost is payload/IO rather than the scan.
--   X) The embed resolves through a foreign key whose column is not the indexed one
--      (for example indexed on legacy_id while the new-lead path filters client_id).

-- ======================= SECTION 1: catalog facts =======================
-- Look for an index whose definition leads with client_id. If none exists, V is confirmed.
SELECT
  (SELECT json_agg(json_build_object('name', indexname, 'def', indexdef) ORDER BY indexname)
     FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'emails')                      AS emails_indexes,
  (SELECT json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid)) ORDER BY conname)
     FROM pg_constraint
    WHERE conrelid = 'public.emails'::regclass AND contype = 'f')              AS emails_foreign_keys,
  (SELECT json_agg(json_build_object('column', column_name, 'type', data_type) ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emails'
      AND column_name IN ('id', 'client_id', 'legacy_id', 'body_html'))        AS key_column_types,
  (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.emails'::regclass) AS emails_estimated_rows;


-- ======================= SECTION 2: chosen plan =======================
-- Plain EXPLAIN (no ANALYZE) so nothing executes and this cannot itself time out.
-- "Seq Scan on emails" confirms V. "Index Scan using ..." rejects V and points at W.
EXPLAIN
SELECT * FROM public.emails
WHERE client_id = (SELECT e.client_id FROM public.emails e WHERE e.client_id IS NOT NULL LIMIT 1);
