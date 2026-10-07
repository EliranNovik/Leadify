-- Document shares: an employee can share a scanned document with another employee.
-- Recipients see unread shares in the header notification bell, in the Shared tab, where they can
-- open the document in the viewer or download it.
-- Mirrors public.lead_shares (sql/2026-08-27_lead_shares.sql).

CREATE TABLE IF NOT EXISTS public.document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_name text NOT NULL,
  document_type text,
  content_type text,
  -- Two ways to reach the bytes. The storage pair outlives the Scan Center queue so it is tried
  -- first; scan_document_id covers a scan whose file has not been copied into storage yet.
  storage_bucket text,
  storage_path text,
  scan_document_id text,
  lead_number text,
  lead_name text,
  note text,
  shared_by_employee_id bigint NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  shared_with_employee_id bigint NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT document_shares_locator_present
    CHECK (storage_path IS NOT NULL OR scan_document_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_document_shares_recipient_unread
  ON public.document_shares (shared_with_employee_id, created_at DESC)
  WHERE read_at IS NULL;

COMMENT ON TABLE public.document_shares IS
  'Employee-to-employee document shares shown in the CRM notification bell until marked read.';

ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view document shares" ON public.document_shares;
CREATE POLICY "Authenticated can view document shares"
  ON public.document_shares
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can insert document shares" ON public.document_shares;
CREATE POLICY "Authenticated can insert document shares"
  ON public.document_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can update document shares" ON public.document_shares;
CREATE POLICY "Authenticated can update document shares"
  ON public.document_shares
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON public.document_shares TO authenticated;
