-- Let the Admin hook logs page receive new access_logs rows without a refresh.
-- Run in the Supabase SQL editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'access_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.access_logs;
  END IF;
END $$;
