-- Private bucket for firm invoice file uploads (path linked from firm_invoices.storage_path)
-- Run after 2026-04-10_firm_management_costs_and_invoices.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-invoice-documents',
  'firm-invoice-documents',
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

DROP POLICY IF EXISTS "firm-invoice-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "firm-invoice-documents select" ON storage.objects;
DROP POLICY IF EXISTS "firm-invoice-documents update" ON storage.objects;
DROP POLICY IF EXISTS "firm-invoice-documents delete" ON storage.objects;

CREATE POLICY "firm-invoice-documents insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firm-invoice-documents');

CREATE POLICY "firm-invoice-documents select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firm-invoice-documents');

CREATE POLICY "firm-invoice-documents update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firm-invoice-documents')
  WITH CHECK (bucket_id = 'firm-invoice-documents');

CREATE POLICY "firm-invoice-documents delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firm-invoice-documents');
