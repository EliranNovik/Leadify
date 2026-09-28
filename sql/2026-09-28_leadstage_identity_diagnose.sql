-- Diagnose two things on public.leads_leadstage. Read-only.
-- Run each SECTION separately: the Supabase SQL editor only returns the last result.
--
-- Context: getLeadIdentity() in src/lib/leadStageManager.ts uses parseInt() on the lead id.
-- parseInt stops at the first non-digit instead of failing, so a UUID like
-- '45edcf01-de27-...' silently becomes 45 and is written to lead_id. When 45 is not a real
-- legacy lead the FK rejects it (the 23503 we logged). When it IS real, the stage row is
-- silently attached to the wrong client, which no error would reveal.

-- ======================= SECTION 1: parseInt truncation damage =======================
-- Legacy lead ids in this system are large (the logs show ids like 223620). Recent rows
-- with a tiny lead_id are very likely parseInt artifacts from a truncated UUID.
-- An empty result means no misattribution has landed.
SELECT
  ls.lead_id,
  count(*)                                   AS stage_rows,
  min(ls.cdate)                              AS first_seen,
  max(ls.cdate)                              AS last_seen,
  EXISTS (SELECT 1 FROM public.leads_lead l WHERE l.id = ls.lead_id) AS parent_lead_exists
FROM public.leads_leadstage ls
WHERE ls.lead_id IS NOT NULL
  AND ls.lead_id < 1000
  AND ls.cdate > now() - interval '90 days'
GROUP BY ls.lead_id
ORDER BY stage_rows DESC
LIMIT 25;


-- ======================= SECTION 2: sequence health =======================
-- Same check that found the leads_leadinteractions defect. owned_sequence IS NULL means
-- fix_leads_leadstage_sequence() cannot resolve the sequence via pg_get_serial_sequence()
-- and is a silent no-op, exactly as resync_leads_leadinteractions_id_seq() was.
SELECT
  c.column_default                                          AS id_default,
  pg_get_serial_sequence('public.leads_leadstage', 'id')     AS owned_sequence,
  s.schemaname || '.' || s.sequencename                      AS sequence_from_default,
  s.last_value                                               AS seq_last_value,
  (SELECT max(id) FROM public.leads_leadstage)               AS max_id,
  (SELECT max(id) FROM public.leads_leadstage) - COALESCE(s.last_value, 0) AS seq_behind_by
FROM information_schema.columns c
LEFT JOIN pg_sequences s
  ON c.column_default LIKE '%' || s.sequencename || '%'
WHERE c.table_schema = 'public'
  AND c.table_name   = 'leads_leadstage'
  AND c.column_name  = 'id';
