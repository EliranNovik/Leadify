-- Personal workspace for each employee: private notes + files.
-- Highlighted leads already live in public.user_highlights.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_personal_notes (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_personal_notes_employee_id_idx
  ON public.employee_personal_notes (employee_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.employee_personal_notes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_personal_notes_set_updated_at ON public.employee_personal_notes;
CREATE TRIGGER employee_personal_notes_set_updated_at
  BEFORE UPDATE ON public.employee_personal_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.employee_personal_notes_set_updated_at();

-- ---------------------------------------------------------------------------
-- Files (metadata; blobs in storage bucket employee-personal-files)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_personal_files (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  document_type TEXT,
  folder_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.employee_personal_files
  ADD COLUMN IF NOT EXISTS document_type TEXT;

CREATE INDEX IF NOT EXISTS employee_personal_files_employee_id_idx
  ON public.employee_personal_files (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS employee_personal_files_document_type_idx
  ON public.employee_personal_files (employee_id, document_type);

-- ---------------------------------------------------------------------------
-- Folders (document membership via employee_personal_files.folder_id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_personal_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id INTEGER NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS employee_personal_folders_employee_id_idx
  ON public.employee_personal_folders (employee_id, sort_order, created_at);

ALTER TABLE public.employee_personal_files
  ADD COLUMN IF NOT EXISTS folder_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_personal_files_folder_id_fkey'
  ) THEN
    ALTER TABLE public.employee_personal_files
      ADD CONSTRAINT employee_personal_files_folder_id_fkey
      FOREIGN KEY (folder_id) REFERENCES public.employee_personal_folders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS employee_personal_files_folder_id_idx
  ON public.employee_personal_files (folder_id);

-- ---------------------------------------------------------------------------
-- RLS (reuse current_user_employee_id / is_app_superuser from HR docs SQL)
-- ---------------------------------------------------------------------------

ALTER TABLE public.employee_personal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_personal_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_personal_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_personal_notes_select_own_or_superuser" ON public.employee_personal_notes;
CREATE POLICY "employee_personal_notes_select_own_or_superuser"
  ON public.employee_personal_notes
  FOR SELECT
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_personal_notes_insert_own" ON public.employee_personal_notes;
CREATE POLICY "employee_personal_notes_insert_own"
  ON public.employee_personal_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_notes_update_own" ON public.employee_personal_notes;
CREATE POLICY "employee_personal_notes_update_own"
  ON public.employee_personal_notes
  FOR UPDATE
  TO authenticated
  USING (employee_id = current_user_employee_id())
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_notes_delete_own" ON public.employee_personal_notes;
CREATE POLICY "employee_personal_notes_delete_own"
  ON public.employee_personal_notes
  FOR DELETE
  TO authenticated
  USING (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_files_select_own_or_superuser" ON public.employee_personal_files;
CREATE POLICY "employee_personal_files_select_own_or_superuser"
  ON public.employee_personal_files
  FOR SELECT
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_personal_files_insert_own" ON public.employee_personal_files;
CREATE POLICY "employee_personal_files_insert_own"
  ON public.employee_personal_files
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_files_update_own" ON public.employee_personal_files;
CREATE POLICY "employee_personal_files_update_own"
  ON public.employee_personal_files
  FOR UPDATE
  TO authenticated
  USING (employee_id = current_user_employee_id())
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_files_delete_own" ON public.employee_personal_files;
CREATE POLICY "employee_personal_files_delete_own"
  ON public.employee_personal_files
  FOR DELETE
  TO authenticated
  USING (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_folders_select_own_or_superuser" ON public.employee_personal_folders;
CREATE POLICY "employee_personal_folders_select_own_or_superuser"
  ON public.employee_personal_folders
  FOR SELECT
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_personal_folders_insert_own" ON public.employee_personal_folders;
CREATE POLICY "employee_personal_folders_insert_own"
  ON public.employee_personal_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_folders_update_own" ON public.employee_personal_folders;
CREATE POLICY "employee_personal_folders_update_own"
  ON public.employee_personal_folders
  FOR UPDATE
  TO authenticated
  USING (employee_id = current_user_employee_id())
  WITH CHECK (employee_id = current_user_employee_id());

DROP POLICY IF EXISTS "employee_personal_folders_delete_own" ON public.employee_personal_folders;
CREATE POLICY "employee_personal_folders_delete_own"
  ON public.employee_personal_folders
  FOR DELETE
  TO authenticated
  USING (employee_id = current_user_employee_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_personal_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_personal_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_personal_folders TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.employee_personal_notes_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.employee_personal_files_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket. Path: {employee_id}/{uuid}_{filename}
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-personal-files',
  'employee-personal-files',
  false,
  20971520,
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
  file_size_limit = 20971520,
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

DROP POLICY IF EXISTS "employee-personal-files upload policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-personal-files select policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-personal-files update policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-personal-files delete policy" ON storage.objects;

CREATE POLICY "employee-personal-files upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-personal-files'
  AND (
    is_app_superuser()
    OR split_part(name, '/', 1) = (current_user_employee_id())::text
  )
);

CREATE POLICY "employee-personal-files select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-personal-files'
  AND (
    is_app_superuser()
    OR split_part(name, '/', 1) = (current_user_employee_id())::text
  )
);

CREATE POLICY "employee-personal-files update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'employee-personal-files'
  AND (
    is_app_superuser()
    OR split_part(name, '/', 1) = (current_user_employee_id())::text
  )
)
WITH CHECK (
  bucket_id = 'employee-personal-files'
  AND (
    is_app_superuser()
    OR split_part(name, '/', 1) = (current_user_employee_id())::text
  )
);

CREATE POLICY "employee-personal-files delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-personal-files'
  AND (
    is_app_superuser()
    OR split_part(name, '/', 1) = (current_user_employee_id())::text
  )
);
