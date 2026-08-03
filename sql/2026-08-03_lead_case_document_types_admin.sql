-- Allow CRM admins to manage lead/case document types
-- (Admin → Misc → Case document types).
-- Used by client portal uploads, CRM Documents tab, and document modals.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_case_document_types TO authenticated;

DROP POLICY IF EXISTS lead_case_document_types_authenticated_select ON public.lead_case_document_types;
CREATE POLICY lead_case_document_types_authenticated_select
  ON public.lead_case_document_types
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS lead_case_document_types_authenticated_all ON public.lead_case_document_types;
CREATE POLICY lead_case_document_types_authenticated_all
  ON public.lead_case_document_types
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
