-- Resync leads_leadinteractions.id sequence after manual MAX(id)+1 inserts (fixes 23505 duplicate pkey on insert).

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
