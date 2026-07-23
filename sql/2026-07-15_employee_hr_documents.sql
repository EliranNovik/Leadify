-- HR document types + employee HR documents (+ private storage bucket)
-- Run in Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Lookup: document types
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hr_document_types (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.hr_document_types (slug, label, sort_order) VALUES
  ('contract', 'Contract', 10),
  ('reviews', 'Reviews', 20),
  ('poa', 'POA', 30),
  ('cv', 'CV', 40),
  ('id', 'ID', 50),
  ('bank_account', 'Bank account', 60),
  ('tax_form', 'Tax Form', 70),
  ('pension', 'Pension', 80),
  ('sick_leave', 'Sick leave', 90),
  ('form_106', 'Form 106', 100),
  ('equipment_checklist', 'Equipment checklist', 110),
  ('system_access_codes', 'System access codes', 120),
  ('other', 'Other', 130)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Employee documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_hr_documents (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES public.hr_document_types(id),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  notes TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_hr_documents_employee_id_idx
  ON public.employee_hr_documents (employee_id);

CREATE INDEX IF NOT EXISTS employee_hr_documents_type_id_idx
  ON public.employee_hr_documents (document_type_id);

CREATE INDEX IF NOT EXISTS employee_hr_documents_employee_type_idx
  ON public.employee_hr_documents (employee_id, document_type_id);

-- ---------------------------------------------------------------------------
-- RLS helpers (idempotent; may already exist from lead reporting)
-- ---------------------------------------------------------------------------

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

ALTER TABLE public.hr_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_hr_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_document_types_select_authenticated" ON public.hr_document_types;
CREATE POLICY "hr_document_types_select_authenticated"
  ON public.hr_document_types
  FOR SELECT
  TO authenticated
  USING (is_active IS TRUE OR is_app_superuser());

DROP POLICY IF EXISTS "hr_document_types_manage_superuser" ON public.hr_document_types;
CREATE POLICY "hr_document_types_manage_superuser"
  ON public.hr_document_types
  FOR ALL
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "employee_hr_documents_select_own_or_superuser" ON public.employee_hr_documents;
CREATE POLICY "employee_hr_documents_select_own_or_superuser"
  ON public.employee_hr_documents
  FOR SELECT
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_hr_documents_insert_own_or_superuser" ON public.employee_hr_documents;
CREATE POLICY "employee_hr_documents_insert_own_or_superuser"
  ON public.employee_hr_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_hr_documents_update_own_or_superuser" ON public.employee_hr_documents;
CREATE POLICY "employee_hr_documents_update_own_or_superuser"
  ON public.employee_hr_documents
  FOR UPDATE
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  )
  WITH CHECK (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

DROP POLICY IF EXISTS "employee_hr_documents_delete_own_or_superuser" ON public.employee_hr_documents;
CREATE POLICY "employee_hr_documents_delete_own_or_superuser"
  ON public.employee_hr_documents
  FOR DELETE
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_app_superuser()
  );

GRANT SELECT ON public.hr_document_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_hr_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hr_document_types_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.employee_hr_documents_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket: employee-hr-documents (private)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-hr-documents',
  'employee-hr-documents',
  false,
  10485760,
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
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
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
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

DROP POLICY IF EXISTS "employee-hr-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-hr-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-hr-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-hr-documents delete policy" ON storage.objects;

-- Path shape: employees/{employee_id}/...
-- Own employee folder or app superuser.
CREATE POLICY "employee-hr-documents upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-hr-documents'
  AND (
    is_app_superuser()
    OR (
      split_part(name, '/', 1) = 'employees'
      AND split_part(name, '/', 2) = (current_user_employee_id())::text
    )
  )
);

CREATE POLICY "employee-hr-documents select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-hr-documents'
  AND (
    is_app_superuser()
    OR (
      split_part(name, '/', 1) = 'employees'
      AND split_part(name, '/', 2) = (current_user_employee_id())::text
    )
  )
);

CREATE POLICY "employee-hr-documents update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'employee-hr-documents'
  AND (
    is_app_superuser()
    OR (
      split_part(name, '/', 1) = 'employees'
      AND split_part(name, '/', 2) = (current_user_employee_id())::text
    )
  )
)
WITH CHECK (
  bucket_id = 'employee-hr-documents'
  AND (
    is_app_superuser()
    OR (
      split_part(name, '/', 1) = 'employees'
      AND split_part(name, '/', 2) = (current_user_employee_id())::text
    )
  )
);

CREATE POLICY "employee-hr-documents delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-hr-documents'
  AND (
    is_app_superuser()
    OR (
      split_part(name, '/', 1) = 'employees'
      AND split_part(name, '/', 2) = (current_user_employee_id())::text
    )
  )
);
