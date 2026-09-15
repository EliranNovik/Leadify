-- Smart Scan AI results: document type, suggested name, and split child PDFs.
-- Run in the Supabase SQL editor. Safe to re-run.
-- Split files are stored in the existing private email-attachments bucket.

CREATE TABLE IF NOT EXISTS public.smart_scan_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NULL REFERENCES public.smart_scan_documents(id) ON DELETE CASCADE,
  source_email_id BIGINT NOT NULL,
  source_graph_attachment_id TEXT NOT NULL,
  storage_path TEXT,
  content_type TEXT,
  original_filename TEXT,
  suggested_filename TEXT,
  title TEXT,
  document_type TEXT,
  suggested_document_type TEXT,
  detected_person_name TEXT,
  detected_country TEXT,
  document_date DATE,
  expiry_date DATE,
  summary TEXT,
  confidence NUMERIC,
  page_count INT,
  page_start INT,
  page_end INT,
  split_index INT,
  status TEXT NOT NULL DEFAULT 'processing',
  classification_status TEXT NOT NULL DEFAULT 'processing',
  lead_match_status TEXT NOT NULL DEFAULT 'unmatched',
  issue TEXT,
  error TEXT,
  ignored BOOLEAN NOT NULL DEFAULT FALSE,
  activity JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_raw JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS smart_scan_documents_source_uidx
  ON public.smart_scan_documents (source_email_id, source_graph_attachment_id)
  WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS smart_scan_documents_email_idx
  ON public.smart_scan_documents (source_email_id, created_at DESC);

CREATE INDEX IF NOT EXISTS smart_scan_documents_parent_idx
  ON public.smart_scan_documents (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS smart_scan_documents_status_idx
  ON public.smart_scan_documents (status)
  WHERE ignored = FALSE;

COMMENT ON TABLE public.smart_scan_documents IS
  'Scan Center AI classification and split PDFs. Source rows have parent_id NULL; children are page-range splits.';

ALTER TABLE public.smart_scan_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_scan_documents_service_all ON public.smart_scan_documents;
CREATE POLICY smart_scan_documents_service_all
  ON public.smart_scan_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS smart_scan_documents_staff_read ON public.smart_scan_documents;
CREATE POLICY smart_scan_documents_staff_read
  ON public.smart_scan_documents
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.smart_scan_documents TO authenticated;
GRANT ALL ON public.smart_scan_documents TO service_role;

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
