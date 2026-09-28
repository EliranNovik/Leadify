-- Diagnose the recurring 23505 on leads_leadinteractions_pkey.
-- Read-only. Single statement so the Supabase SQL editor returns the full result.
--
-- What to look for:
--   owned_sequence IS NULL      -> resync_leads_leadinteractions_id_seq() is a silent no-op,
--                                  because pg_get_serial_sequence only sees sequences linked
--                                  to the column by an OWNED BY dependency.
--   seq_last_value < max_id     -> the sequence is behind, so nextval collides with live rows.
--   resync_fn_count = 0         -> the self-heal RPC was never installed.

SELECT
  c.column_default                                              AS id_default,
  c.is_nullable                                                 AS id_is_nullable,
  pg_get_serial_sequence('public.leads_leadinteractions', 'id')  AS owned_sequence,
  s.schemaname || '.' || s.sequencename                         AS sequence_from_default,
  s.last_value                                                  AS seq_last_value,
  (SELECT max(id) FROM public.leads_leadinteractions)           AS max_id,
  (SELECT max(id) FROM public.leads_leadinteractions) - COALESCE(s.last_value, 0) AS seq_behind_by,
  (SELECT count(*) FROM pg_proc
    WHERE proname = 'resync_leads_leadinteractions_id_seq')      AS resync_fn_count
FROM information_schema.columns c
LEFT JOIN pg_sequences s
  ON c.column_default LIKE '%' || s.sequencename || '%'
WHERE c.table_schema = 'public'
  AND c.table_name   = 'leads_leadinteractions'
  AND c.column_name  = 'id';
