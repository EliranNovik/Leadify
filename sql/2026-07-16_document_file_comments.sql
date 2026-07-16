-- Threaded employee comments on a stored document file (case docs, sub-effort docs, etc.).
-- Keyed by storage_path so the same file keeps one comment thread wherever it is shown.

CREATE TABLE IF NOT EXISTS public.document_file_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  body text NOT NULL,
  created_by text NOT NULL,
  created_by_employee_id bigint NULL REFERENCES public.tenants_employee (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_file_comments_body_not_blank CHECK (char_length(trim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_document_file_comments_path_created
  ON public.document_file_comments (storage_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_file_comments_employee
  ON public.document_file_comments (created_by_employee_id)
  WHERE created_by_employee_id IS NOT NULL;

COMMENT ON TABLE public.document_file_comments IS
  'Employee comments on a document file identified by storage_path (shared across case / sub-effort views).';
COMMENT ON COLUMN public.document_file_comments.storage_path IS
  'Object path inside the documents storage bucket (e.g. lead-sub-efforts-documents).';

ALTER TABLE public.document_file_comments
  ADD COLUMN IF NOT EXISTS highlight jsonb NULL;

COMMENT ON COLUMN public.document_file_comments.highlight IS
  'Optional region highlight: { x, y, w, h } in 0–1 coords; optional page (1-based) for PDFs.';

ALTER TABLE public.document_file_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_file_comments_select" ON public.document_file_comments;
CREATE POLICY "document_file_comments_select" ON public.document_file_comments
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "document_file_comments_insert" ON public.document_file_comments;
CREATE POLICY "document_file_comments_insert" ON public.document_file_comments
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "document_file_comments_update" ON public.document_file_comments;
CREATE POLICY "document_file_comments_update" ON public.document_file_comments
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "document_file_comments_delete" ON public.document_file_comments;
CREATE POLICY "document_file_comments_delete" ON public.document_file_comments
  FOR DELETE USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_file_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_file_comments TO service_role;
