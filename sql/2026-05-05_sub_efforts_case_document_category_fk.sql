-- Connect sub effort templates (`sub_efforts`) to case document categories.
-- This allows documents uploaded under a sub-effort log row to appear under the mapped category tab in the Case Documents modal.

ALTER TABLE public.sub_efforts
  ADD COLUMN IF NOT EXISTS case_document_classification_id uuid;

DO $$
BEGIN
  -- Add FK (idempotent)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sub_efforts_case_document_classification_id_fkey'
  ) THEN
    ALTER TABLE public.sub_efforts
      ADD CONSTRAINT sub_efforts_case_document_classification_id_fkey
      FOREIGN KEY (case_document_classification_id)
      REFERENCES public.case_document_classifications (id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_sub_efforts_case_document_classification_id
  ON public.sub_efforts (case_document_classification_id)
  WHERE case_document_classification_id IS NOT NULL;

