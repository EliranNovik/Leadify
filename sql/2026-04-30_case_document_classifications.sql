-- Case document classifications (lookup) and per-upload metadata (links OneDrive item to category).

CREATE TABLE IF NOT EXISTS public.case_document_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_number text NOT NULL,
  onedrive_subfolder text,
  onedrive_item_id text NOT NULL,
  file_name text NOT NULL,
  classification_id uuid NOT NULL REFERENCES public.case_document_classifications (id) ON DELETE RESTRICT,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_case_documents_lead_item_unique UNIQUE (lead_number, onedrive_item_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_lead_number ON public.lead_case_documents (lead_number);
CREATE INDEX IF NOT EXISTS idx_lead_case_documents_subfolder ON public.lead_case_documents (onedrive_subfolder);
CREATE INDEX IF NOT EXISTS idx_lead_case_documents_classification_id ON public.lead_case_documents (classification_id);

ALTER TABLE public.case_document_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_case_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_document_classifications_select" ON public.case_document_classifications;
CREATE POLICY "case_document_classifications_select" ON public.case_document_classifications
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "lead_case_documents_select" ON public.lead_case_documents;
CREATE POLICY "lead_case_documents_select" ON public.lead_case_documents
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_case_documents_insert" ON public.lead_case_documents;
CREATE POLICY "lead_case_documents_insert" ON public.lead_case_documents
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_case_documents_update" ON public.lead_case_documents;
CREATE POLICY "lead_case_documents_update" ON public.lead_case_documents
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_case_documents_delete" ON public.lead_case_documents;
CREATE POLICY "lead_case_documents_delete" ON public.lead_case_documents
  FOR DELETE USING (auth.uid() IS NOT NULL);

INSERT INTO public.case_document_classifications (slug, label, sort_order) VALUES
  ('application_documents', 'Application documents', 10),
  ('court_documents', 'Court documents', 20),
  ('personal_documents', 'Personal documents', 30),
  ('case_handler_documents', 'Case handler documents', 40),
  ('contract', 'Contract', 50),
  ('invoices', 'Invoices', 60)
ON CONFLICT (slug) DO NOTHING;

GRANT SELECT ON public.case_document_classifications TO authenticated;
GRANT SELECT ON public.case_document_classifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_case_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_case_documents TO service_role;
