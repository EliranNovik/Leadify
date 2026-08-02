-- Allow CRM admins to manage HR document types (Admin → Tenants → HR document types).
-- Used by My Profile → Documents upload dropdown (`hr_document_types`).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_document_types TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hr_document_types_id_seq TO authenticated;

DROP POLICY IF EXISTS "hr_document_types_select_authenticated" ON public.hr_document_types;
CREATE POLICY "hr_document_types_select_authenticated"
  ON public.hr_document_types
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hr_document_types_manage_superuser" ON public.hr_document_types;
DROP POLICY IF EXISTS "hr_document_types_manage_authenticated" ON public.hr_document_types;
CREATE POLICY "hr_document_types_manage_authenticated"
  ON public.hr_document_types
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
