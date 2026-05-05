-- Case documents: store files in Supabase Storage (same bucket as sub-efforts) instead of OneDrive metadata.
-- New rows use `storage_path` + nullable `onedrive_item_id`; legacy Graph rows may remain until migrated.

ALTER TABLE public.lead_case_documents
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS mime_type text;

ALTER TABLE public.lead_case_documents
  ALTER COLUMN onedrive_item_id DROP NOT NULL;

ALTER TABLE public.lead_case_documents
  ALTER COLUMN classification_id DROP NOT NULL;

ALTER TABLE public.lead_case_documents
  DROP CONSTRAINT IF EXISTS lead_case_documents_lead_item_unique;

CREATE UNIQUE INDEX IF NOT EXISTS lead_case_documents_storage_path_unique
  ON public.lead_case_documents (lead_number, storage_path)
  WHERE storage_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_case_documents_onedrive_legacy_unique
  ON public.lead_case_documents (lead_number, onedrive_item_id)
  WHERE onedrive_item_id IS NOT NULL AND storage_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_storage_path
  ON public.lead_case_documents (storage_path)
  WHERE storage_path IS NOT NULL;

-- Case documents share this bucket; widen allowlist so uploads are not rejected for common office / archive types.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed'
]
WHERE id = 'lead-sub-efforts-documents';
