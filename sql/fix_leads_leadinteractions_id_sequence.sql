-- Resync leads_leadinteractions.id sequence after manual MAX(id)+1 inserts (fixes 23505 duplicate pkey on insert).
-- PostgREST inserts omit id and use nextval; if the sequence is behind MAX(id), every save logs 23505.
-- Safe to re-run in the SQL editor.

DO $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.leads_leadinteractions', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM public.leads_leadinteractions), 1), true)',
      seq_name
    );
    RAISE NOTICE 'Resynced % to MAX(id)', seq_name;
  ELSE
    RAISE NOTICE 'No serial sequence on leads_leadinteractions.id — app uses explicit id fallback on 23505';
  END IF;
END $$;

-- App self-heal: on 23505, insertLegacyLeadInteraction calls this then retries without an explicit id
-- so nextval stays in sync (explicit MAX(id)+1 inserts leave the sequence behind).
CREATE OR REPLACE FUNCTION public.resync_leads_leadinteractions_id_seq()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_name text;
  max_id bigint;
BEGIN
  SELECT COALESCE(MAX(id), 1) INTO max_id FROM public.leads_leadinteractions;
  seq_name := pg_get_serial_sequence('public.leads_leadinteractions', 'id');
  IF seq_name IS NOT NULL THEN
    PERFORM setval(seq_name, max_id, true);
  END IF;
  RETURN max_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_leads_leadinteractions_id_seq() TO authenticated, anon;
