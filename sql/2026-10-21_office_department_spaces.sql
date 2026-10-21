-- Office documents split into one space per firm department.
-- The original store keeps its rows with department_id IS NULL and is shown as "Admins": same
-- table, same office-documents bucket, same office/ path prefix, so nothing already filed moves
-- or changes hands. Department spaces are new rows under office/dept-<id>/.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Which space a row belongs to
-- ---------------------------------------------------------------------------

ALTER TABLE public.office_documents
  ADD COLUMN IF NOT EXISTS department_id bigint;

ALTER TABLE public.office_document_folders
  ADD COLUMN IF NOT EXISTS department_id bigint;

COMMENT ON COLUMN public.office_documents.department_id IS
  'The department space the file lives in. NULL is the original admin-only space.';
COMMENT ON COLUMN public.office_document_folders.department_id IS
  'The department space the folder lives in. NULL is the original admin-only space.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_documents_department_id_fkey'
  ) THEN
    ALTER TABLE public.office_documents
      ADD CONSTRAINT office_documents_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES public.tenant_departement (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_document_folders_department_id_fkey'
  ) THEN
    ALTER TABLE public.office_document_folders
      ADD CONSTRAINT office_document_folders_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES public.tenant_departement (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS office_documents_department_idx
  ON public.office_documents (department_id, created_at DESC);

CREATE INDEX IF NOT EXISTS office_document_folders_department_idx
  ON public.office_document_folders (department_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------

-- Also created by 2026-10-21_document_folders.sql; repeated so this file stands alone.
CREATE OR REPLACE FUNCTION public.current_user_employee_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.employee_id
  FROM public.users u
  WHERE u.auth_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_employee_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_department_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.department_id
  FROM public.tenants_employee e
  WHERE e.id = public.current_user_employee_id()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_department_id() TO authenticated;

-- Superusers reach every space; everyone else only their own department's.
CREATE OR REPLACE FUNCTION public.can_use_office_space(dept bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_app_superuser()
      OR (dept IS NOT NULL AND dept = public.current_user_department_id());
$$;

GRANT EXECUTE ON FUNCTION public.can_use_office_space(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: the admin space stays superuser-only, department spaces follow the staff
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "office_document_folders_select_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_select_superuser"
  ON public.office_document_folders
  FOR SELECT
  TO authenticated
  USING (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_document_folders_insert_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_insert_superuser"
  ON public.office_document_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_document_folders_update_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_update_superuser"
  ON public.office_document_folders
  FOR UPDATE
  TO authenticated
  USING (public.can_use_office_space(department_id))
  WITH CHECK (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_document_folders_delete_superuser" ON public.office_document_folders;
CREATE POLICY "office_document_folders_delete_superuser"
  ON public.office_document_folders
  FOR DELETE
  TO authenticated
  USING (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_documents_select_superuser" ON public.office_documents;
CREATE POLICY "office_documents_select_superuser"
  ON public.office_documents
  FOR SELECT
  TO authenticated
  USING (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_documents_insert_superuser" ON public.office_documents;
CREATE POLICY "office_documents_insert_superuser"
  ON public.office_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_documents_update_superuser" ON public.office_documents;
CREATE POLICY "office_documents_update_superuser"
  ON public.office_documents
  FOR UPDATE
  TO authenticated
  USING (public.can_use_office_space(department_id))
  WITH CHECK (public.can_use_office_space(department_id));

DROP POLICY IF EXISTS "office_documents_delete_superuser" ON public.office_documents;
CREATE POLICY "office_documents_delete_superuser"
  ON public.office_documents
  FOR DELETE
  TO authenticated
  USING (public.can_use_office_space(department_id));

-- ---------------------------------------------------------------------------
-- Storage: the department is in the object path, so one space cannot read another
--   office/{uuid}_{file}            admin space, unchanged from before (superusers only)
--   office/dept-12/{uuid}_{file}    department space
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "office-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "office-documents delete policy" ON storage.objects;

CREATE POLICY "office-documents upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'office-documents'
  AND (
    public.is_app_superuser()
    OR name LIKE 'office/dept-' || COALESCE(public.current_user_department_id(), -1)::text || '/%'
  )
);

CREATE POLICY "office-documents select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND (
    public.is_app_superuser()
    OR name LIKE 'office/dept-' || COALESCE(public.current_user_department_id(), -1)::text || '/%'
  )
);

CREATE POLICY "office-documents update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND (
    public.is_app_superuser()
    OR name LIKE 'office/dept-' || COALESCE(public.current_user_department_id(), -1)::text || '/%'
  )
)
WITH CHECK (
  bucket_id = 'office-documents'
  AND (
    public.is_app_superuser()
    OR name LIKE 'office/dept-' || COALESCE(public.current_user_department_id(), -1)::text || '/%'
  )
);

CREATE POLICY "office-documents delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'office-documents'
  AND (
    public.is_app_superuser()
    OR name LIKE 'office/dept-' || COALESCE(public.current_user_department_id(), -1)::text || '/%'
  )
);

NOTIFY pgrst, 'reload schema';
