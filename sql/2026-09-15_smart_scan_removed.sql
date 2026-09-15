-- Remember deleted Scan Center documents so mailbox auto-fetch does not recreate them.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.smart_scan_removed (
  source_graph_attachment_id TEXT PRIMARY KEY,
  source_email_id BIGINT,
  graph_message_id TEXT,
  original_filename TEXT,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS smart_scan_removed_message_idx
  ON public.smart_scan_removed (graph_message_id)
  WHERE graph_message_id IS NOT NULL;

ALTER TABLE public.smart_scan_removed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_scan_removed_service_all ON public.smart_scan_removed;
CREATE POLICY smart_scan_removed_service_all
  ON public.smart_scan_removed
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS smart_scan_removed_staff_read ON public.smart_scan_removed;
CREATE POLICY smart_scan_removed_staff_read
  ON public.smart_scan_removed
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.smart_scan_removed TO authenticated;
GRANT ALL ON public.smart_scan_removed TO service_role;
