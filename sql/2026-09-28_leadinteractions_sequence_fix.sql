-- Fix the recurring 23505 on leads_leadinteractions_pkey.
--
-- Evidence (from 2026-09-28_leadinteractions_sequence_diagnose.sql against production):
--   id_default            = nextval('leads_leadinteractions_id_seq'::regclass)
--   owned_sequence        = NULL      <-- pg_get_serial_sequence() cannot resolve it
--   sequence_from_default = public.leads_leadinteractions_id_seq
--   seq_last_value        = 2313017
--   max_id                = 2320670
--   seq_behind_by         = 7653
--   resync_fn_count       = 1
--
-- The sequence drives the column default but was never linked to the column with an
-- OWNED BY dependency. pg_get_serial_sequence() only resolves sequences that carry that
-- link, so resync_leads_leadinteractions_id_seq() took its "seq_name IS NULL" branch,
-- skipped the setval, and returned max_id as though it had succeeded. The app therefore
-- retried straight back into the collision and fell through to an explicit MAX(id)+1
-- insert, which does not advance the sequence -- so the gap never closed.
--
-- No frontend deploy is required: once the sequence is correct the first insert succeeds
-- and the retry ladder in insertLegacyLeadInteraction() never runs.
--
-- Both statements below are catalog/metadata only and take no lock on the
-- leads_leadinteractions table itself, so this is safe to run while workers are active.

-- 1. Close the current gap so nextval() stops handing out live ids.
--    Resolved from the column default rather than pg_get_serial_sequence() for the same
--    reason the original fix failed.
SELECT setval(
  'public.leads_leadinteractions_id_seq',
  (SELECT COALESCE(MAX(id), 1) FROM public.leads_leadinteractions),
  true
);

-- 2. Harden the self-heal so it can never silently no-op again. Read the sequence out of
--    the column's DEFAULT expression, which works whether or not an OWNED BY link exists.
CREATE OR REPLACE FUNCTION public.resync_leads_leadinteractions_id_seq()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_name text;
  max_id   bigint;
BEGIN
  SELECT COALESCE(MAX(id), 1) INTO max_id FROM public.leads_leadinteractions;

  seq_name := pg_get_serial_sequence('public.leads_leadinteractions', 'id');

  -- Fall back to parsing the column default when no OWNED BY dependency exists.
  IF seq_name IS NULL THEN
    SELECT substring(pg_get_expr(d.adbin, d.adrelid) FROM 'nextval\(''([^'']+)''')
      INTO seq_name
      FROM pg_attrdef d
      JOIN pg_attribute a
        ON a.attrelid = d.adrelid
       AND a.attnum   = d.adnum
     WHERE d.adrelid = 'public.leads_leadinteractions'::regclass
       AND a.attname = 'id';
  END IF;

  IF seq_name IS NULL THEN
    RAISE WARNING 'resync_leads_leadinteractions_id_seq: no sequence found for id column';
    RETURN max_id;
  END IF;

  PERFORM setval(seq_name, max_id, true);
  RETURN max_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_leads_leadinteractions_id_seq() TO authenticated, anon;

-- 3. Verify. Expect seq_behind_by <= 0 and owned_sequence still NULL (harmless now that
--    the function no longer depends on it).
SELECT
  pg_get_serial_sequence('public.leads_leadinteractions', 'id') AS owned_sequence,
  s.last_value                                                  AS seq_last_value,
  (SELECT max(id) FROM public.leads_leadinteractions)            AS max_id,
  (SELECT max(id) FROM public.leads_leadinteractions) - s.last_value AS seq_behind_by
FROM pg_sequences s
WHERE s.schemaname = 'public'
  AND s.sequencename = 'leads_leadinteractions_id_seq';

-- Optional hygiene, NOT required by the fix above. This makes pg_get_serial_sequence()
-- resolve normally and ties the sequence's lifecycle to the column. It takes a brief
-- AccessExclusiveLock on the sequence (not the table), so run it during a quiet moment.
--
-- ALTER SEQUENCE public.leads_leadinteractions_id_seq
--   OWNED BY public.leads_leadinteractions.id;
