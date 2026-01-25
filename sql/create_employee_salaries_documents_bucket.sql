-- Create storage bucket for employee salary documents (payroll PDFs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-salary-documents',
  'employee-salary-documents',
  false, -- Private bucket
  10485760, -- 10MB limit
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];

-- Policies for authenticated users
DROP POLICY IF EXISTS "Allow authenticated users to upload salary documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to view salary documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete salary documents" ON storage.objects;

CREATE POLICY "Allow authenticated users to upload salary documents" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'employee-salary-documents');

CREATE POLICY "Allow authenticated users to view salary documents" ON storage.objects
FOR SELECT TO authenticated USING (bucket_id = 'employee-salary-documents');

CREATE POLICY "Allow authenticated users to delete salary documents" ON storage.objects
FOR DELETE TO authenticated USING (bucket_id = 'employee-salary-documents');
