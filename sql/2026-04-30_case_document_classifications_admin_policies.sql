-- Allow authenticated CRM users to create/update/delete case document classification rows (Admin → Case document categories).
-- Deletes still fail while `lead_case_documents` references a row (ON DELETE RESTRICT).

GRANT INSERT, UPDATE, DELETE ON public.case_document_classifications TO authenticated;

DROP POLICY IF EXISTS "case_document_classifications_insert" ON public.case_document_classifications;
CREATE POLICY "case_document_classifications_insert" ON public.case_document_classifications
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "case_document_classifications_update" ON public.case_document_classifications;
CREATE POLICY "case_document_classifications_update" ON public.case_document_classifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "case_document_classifications_delete" ON public.case_document_classifications;
CREATE POLICY "case_document_classifications_delete" ON public.case_document_classifications
  FOR DELETE TO authenticated USING (true);
