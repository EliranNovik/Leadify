-- Scan Center stopped receiving new scans because every email_attachments insert failed.
-- This database still has the pre-2026-09-14 columns (attachment_id NOT NULL, file_name,
-- downloaded), and the mailbox sync only writes the new columns, so Postgres rejected the
-- row with 23502 ("null value in column attachment_id"). Without attachment rows nothing
-- reaches smart_scan_documents, so /smart-scan kept showing the old queue.
--
-- The backend now writes attachment_id / file_name as well; this migration makes the legacy
-- columns optional so inserts also work for any other writer.
-- Safe to re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_attachments'
      AND column_name = 'attachment_id'
  ) THEN
    UPDATE public.email_attachments
    SET attachment_id = graph_attachment_id
    WHERE attachment_id IS NULL
      AND graph_attachment_id IS NOT NULL;

    ALTER TABLE public.email_attachments ALTER COLUMN attachment_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_attachments'
      AND column_name = 'file_name'
  ) THEN
    UPDATE public.email_attachments
    SET file_name = name
    WHERE file_name IS NULL
      AND name IS NOT NULL;

    ALTER TABLE public.email_attachments ALTER COLUMN file_name DROP NOT NULL;
  END IF;
END $$;

-- Keep the old and new column pairs in sync whichever one a writer fills in.
-- The body is built from the columns this database actually has.
DO $$
DECLARE
  has_attachment_id boolean;
  has_file_name boolean;
  body text := '';
BEGIN
  SELECT
    bool_or(column_name = 'attachment_id'),
    bool_or(column_name = 'file_name')
  INTO has_attachment_id, has_file_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'email_attachments';

  IF NOT COALESCE(has_attachment_id, false) AND NOT COALESCE(has_file_name, false) THEN
    DROP TRIGGER IF EXISTS email_attachments_sync_legacy_columns_trg ON public.email_attachments;
    RETURN;
  END IF;

  IF COALESCE(has_attachment_id, false) THEN
    body := body || '
      IF NEW.graph_attachment_id IS NULL THEN
        NEW.graph_attachment_id := NEW.attachment_id;
      ELSIF NEW.attachment_id IS NULL THEN
        NEW.attachment_id := NEW.graph_attachment_id;
      END IF;';
  END IF;

  IF COALESCE(has_file_name, false) THEN
    body := body || '
      IF NEW.name IS NULL THEN
        NEW.name := NEW.file_name;
      ELSIF NEW.file_name IS NULL THEN
        NEW.file_name := NEW.name;
      END IF;';
  END IF;

  EXECUTE 'CREATE OR REPLACE FUNCTION public.email_attachments_sync_legacy_columns()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN' || body || '
      RETURN NEW;
    END;
    $fn$;';

  DROP TRIGGER IF EXISTS email_attachments_sync_legacy_columns_trg ON public.email_attachments;
  CREATE TRIGGER email_attachments_sync_legacy_columns_trg
    BEFORE INSERT OR UPDATE ON public.email_attachments
    FOR EACH ROW
    EXECUTE FUNCTION public.email_attachments_sync_legacy_columns();
END $$;

NOTIFY pgrst, 'reload schema';
