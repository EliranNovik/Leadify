-- Live Smart Scan queue updates (classification, splits, new source rows).
-- Safe to re-run.

DO $pub$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.smart_scan_documents;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END;
$pub$;
