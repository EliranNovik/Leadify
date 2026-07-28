-- Private bucket for lead expense receipt / invoice uploads
-- Path convention: lead-expenses/<expenseRowId>/<timestamp>_<filename>
-- Run after sql/2026-07-28_lead_expenses.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lead-expense-documents',
  'lead-expense-documents',
  false,
  15728640, -- 15 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "lead-expense-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "lead-expense-documents select" ON storage.objects;
DROP POLICY IF EXISTS "lead-expense-documents update" ON storage.objects;
DROP POLICY IF EXISTS "lead-expense-documents delete" ON storage.objects;

CREATE POLICY "lead-expense-documents insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lead-expense-documents');

CREATE POLICY "lead-expense-documents select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lead-expense-documents');

CREATE POLICY "lead-expense-documents update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'lead-expense-documents')
  WITH CHECK (bucket_id = 'lead-expense-documents');

CREATE POLICY "lead-expense-documents delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lead-expense-documents');
