-- Screenshot of overtime (above tenants_employee.min_hours) WhatsApp approval from Michael Decker.
-- Run after sql/employee_clock_in_approval_columns.sql

ALTER TABLE public.employee_clock_in
  ADD COLUMN IF NOT EXISTS overtime_approval_storage_path text,
  ADD COLUMN IF NOT EXISTS overtime_approval_file_name text,
  ADD COLUMN IF NOT EXISTS overtime_approval_mime_type text;

COMMENT ON COLUMN public.employee_clock_in.overtime_approval_storage_path IS
  'Private storage path of the overtime WhatsApp-approval screenshot (bucket employee-clock-in-overtime-approvals).';
COMMENT ON COLUMN public.employee_clock_in.overtime_approval_file_name IS
  'Original file name of the overtime approval screenshot.';
COMMENT ON COLUMN public.employee_clock_in.overtime_approval_mime_type IS
  'MIME type of the overtime approval screenshot.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-clock-in-overtime-approvals',
  'employee-clock-in-overtime-approvals',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
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
    'application/pdf'
  ];

DROP POLICY IF EXISTS "employee-clock-in-overtime-approvals upload policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-clock-in-overtime-approvals select policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-clock-in-overtime-approvals update policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-clock-in-overtime-approvals delete policy" ON storage.objects;

CREATE POLICY "employee-clock-in-overtime-approvals upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'employee-clock-in-overtime-approvals');

CREATE POLICY "employee-clock-in-overtime-approvals select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'employee-clock-in-overtime-approvals');

CREATE POLICY "employee-clock-in-overtime-approvals update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'employee-clock-in-overtime-approvals')
WITH CHECK (bucket_id = 'employee-clock-in-overtime-approvals');

CREATE POLICY "employee-clock-in-overtime-approvals delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'employee-clock-in-overtime-approvals');
