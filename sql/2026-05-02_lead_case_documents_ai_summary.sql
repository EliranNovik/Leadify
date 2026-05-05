-- AI-generated summaries for case documents (filled by `case-document-summarize` edge function).

ALTER TABLE public.lead_case_documents
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_status text,
  ADD COLUMN IF NOT EXISTS ai_summary_error text,
  ADD COLUMN IF NOT EXISTS ai_summary_at timestamptz;

ALTER TABLE public.lead_case_documents
  DROP CONSTRAINT IF EXISTS lead_case_documents_ai_summary_status_check;

ALTER TABLE public.lead_case_documents
  ADD CONSTRAINT lead_case_documents_ai_summary_status_check
  CHECK (
    ai_summary_status IS NULL
    OR ai_summary_status IN ('pending', 'ready', 'failed', 'skipped')
  );

COMMENT ON COLUMN public.lead_case_documents.ai_summary IS 'Plain-text AI summary of the stored file.';
COMMENT ON COLUMN public.lead_case_documents.ai_summary_status IS 'pending | ready | failed | skipped';
COMMENT ON COLUMN public.lead_case_documents.ai_summary_error IS 'Last error when status is failed (optional).';
COMMENT ON COLUMN public.lead_case_documents.ai_summary_at IS 'When the summary was last computed or attempted.';
