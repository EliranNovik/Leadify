-- Background AI summaries for case documents
-- Goal: summarization continues even if the user closes the drawer immediately after upload.
--
-- This uses pg_net to POST to the edge function with a shared secret header.
-- Steps:
-- 1) Run this SQL.
-- 2) Insert your project URL + secret into app_private.runtime_config (see below).
-- 3) Set the same secret as an Edge Function secret: CASE_DOC_SUMMARY_SECRET
-- 4) Redeploy `case-document-summarize`.

-- 1) Ensure pg_net exists
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Store runtime config in DB (avoid hardcoding in trigger function)
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE IF NOT EXISTS app_private.runtime_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- One-time setup (edit values before running):
-- INSERT INTO app_private.runtime_config (key, value) VALUES
--   ('supabase_url', 'https://<YOUR-PROJECT-REF>.supabase.co'),
--   ('case_doc_summary_secret', '<RANDOM_LONG_SECRET>')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 3) Trigger function: enqueue HTTP call to edge function
CREATE OR REPLACE FUNCTION app_private.enqueue_case_document_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  secret text;
BEGIN
  -- only for storage-backed rows that are pending summary
  IF NEW.storage_path IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ai_summary_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO base_url FROM app_private.runtime_config WHERE key = 'supabase_url';
  SELECT value INTO secret FROM app_private.runtime_config WHERE key = 'case_doc_summary_secret';

  IF base_url IS NULL OR secret IS NULL THEN
    -- not configured; do nothing
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := base_url || '/functions/v1/case-document-summarize',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-case-doc-summary-secret', secret
    ),
    body := jsonb_build_object('documentId', NEW.id, 'force', false)
  );

  RETURN NEW;
END;
$$;

-- 4) Trigger: fire after insert (and also after status set back to pending)
DROP TRIGGER IF EXISTS trg_case_doc_summary_enqueue ON public.lead_case_documents;

CREATE TRIGGER trg_case_doc_summary_enqueue
AFTER INSERT OR UPDATE OF ai_summary_status ON public.lead_case_documents
FOR EACH ROW
WHEN (NEW.storage_path IS NOT NULL AND NEW.ai_summary_status = 'pending')
EXECUTE FUNCTION app_private.enqueue_case_document_summary();

