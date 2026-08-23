-- Staff-authored Word drafts (TipTap JSON) with optional public share token
-- and a link to the uploaded .docx in lead_case_documents.

CREATE TABLE IF NOT EXISTS public.lead_word_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_number text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled document',
  content jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  classification_key text
    CHECK (
      classification_key IS NULL
      OR classification_key IN ('sequence_of_events', 'legal_claims', 'expert', 'contract')
    ),
  public_token text UNIQUE,
  case_document_id uuid REFERENCES public.lead_case_documents (id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_word_documents_lead_number
  ON public.lead_word_documents (lead_number);

CREATE INDEX IF NOT EXISTS idx_lead_word_documents_public_token
  ON public.lead_word_documents (public_token)
  WHERE public_token IS NOT NULL;

ALTER TABLE public.lead_word_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_word_documents_select_auth" ON public.lead_word_documents;
CREATE POLICY "lead_word_documents_select_auth" ON public.lead_word_documents
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_word_documents_select_public" ON public.lead_word_documents;
CREATE POLICY "lead_word_documents_select_public" ON public.lead_word_documents
  FOR SELECT
  USING (public_token IS NOT NULL);

DROP POLICY IF EXISTS "lead_word_documents_insert" ON public.lead_word_documents;
CREATE POLICY "lead_word_documents_insert" ON public.lead_word_documents
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_word_documents_update" ON public.lead_word_documents;
CREATE POLICY "lead_word_documents_update" ON public.lead_word_documents
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_word_documents_delete" ON public.lead_word_documents;
CREATE POLICY "lead_word_documents_delete" ON public.lead_word_documents
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_word_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_word_documents TO service_role;
GRANT SELECT ON public.lead_word_documents TO anon;
