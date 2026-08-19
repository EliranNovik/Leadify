-- Organization office documents (leases, vehicle agreements, etc.).
-- Superuser-only. Safe to re-run.

CREATE OR REPLACE FUNCTION public.is_app_superuser()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_app_superuser() TO authenticated;

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.office_document_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS office_document_folders_sort_idx
  ON public.office_document_folders (sort_order, created_at);

-- ---------------------------------------------------------------------------
-- Files (metadata; blobs in storage bucket office-documents)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.office_documents (
  id BIGSERIAL PRIMARY KEY,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  document_type TEXT,
  folder_id UUID,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.office_documents
  ADD COLUMN IF NOT EXISTS document_type TEXT;

ALTER TABLE public.office_documents
  ADD COLUMN IF NOT EXISTS folder_id UUID;

ALTER TABLE public.office_documents
  ADD COLUMN IF NOT EXISTS created_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_documents_folder_id_fkey'
  ) THEN
    ALTER TABLE public.office_documents
      ADD CONSTRAINT office_documents_folder_id_fkey
      FOREIGN KEY (folder_id) REFERENCES public.office_document_folders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS office_documents_created_at_idx
  ON public.office_documents (created_at DESC);

CREATE INDEX IF NOT EXISTS office_documents_document_type_idx
  ON public.office_documents (document_type);

CREATE INDEX IF NOT EXISTS office_documents_folder_id_idx
  ON public.office_documents (folder_id);

-- ---------------------------------------------------------------------------
-- RLS: superusers only
-- ---------------------------------------------------------------------------

ALTER TABLE public.office_document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_document_folders_select_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_select_superuser"
  ON public.office_document_folders
  FOR SELECT
  TO authenticated
  USING (is_app_superuser());

DROP POLICY IF EXISTS "office_document_folders_insert_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_insert_superuser"
  ON public.office_document_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "office_document_folders_update_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_update_superuser"
  ON public.office_document_folders
  FOR UPDATE
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "office_document_folders_delete_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_delete_superuser"
  ON public.office_document_folders
  FOR DELETE
  TO authenticated
  USING (is_app_superuser());

DROP POLICY IF EXISTS "office_documents_select_superuser" ON public.office_documents;
CREATE POLICY "office_documents_select_superuser"
  ON public.office_documents
  FOR SELECT
  TO authenticated
  USING (is_app_superuser());

DROP POLICY IF EXISTS "office_documents_insert_superuser" ON public.office_documents;
CREATE POLICY "office_documents_insert_superuser"
  ON public.office_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "office_documents_update_superuser" ON public.office_documents;
CREATE POLICY "office_documents_update_superuser"
  ON public.office_documents
  FOR UPDATE
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "office_documents_delete_superuser" ON public.office_documents;
CREATE POLICY "office_documents_delete_superuser"
  ON public.office_documents
  FOR DELETE
  TO authenticated
  USING (is_app_superuser());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_document_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.office_documents_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket. Path: office/{uuid}_{filename}
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'office-documents',
  'office-documents',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ];

DROP POLICY IF EXISTS "office-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents delete policy" ON storage.objects;

CREATE POLICY "office-documents upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'office-documents'
  AND is_app_superuser()
);

CREATE POLICY "office-documents select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND is_app_superuser()
);

CREATE POLICY "office-documents update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND is_app_superuser()
)
WITH CHECK (
  bucket_id = 'office-documents'
  AND is_app_superuser()
);

CREATE POLICY "office-documents delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND is_app_superuser()
);
