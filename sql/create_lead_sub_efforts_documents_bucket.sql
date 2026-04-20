-- Storage bucket for lead_sub_efforts documents
-- Use this bucket to upload files related to a specific sub-effort log row.
-- Recommended path convention:
--   lead-sub-efforts-documents/<leadId>/<leadSubEffortRowId>/<filename>
--
-- Note: Do NOT run: ALTER TABLE storage.objects ...
-- Supabase manages RLS on storage.objects; only add bucket + policies.

-- Step 1: Ensure the bucket exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lead-sub-efforts-documents',
  'lead-sub-efforts-documents',
  false, -- private bucket
  10485760, -- 10MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
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
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

-- Step 2: Drop existing policies (idempotent)
DROP POLICY IF EXISTS "lead-sub-efforts-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "lead-sub-efforts-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "lead-sub-efforts-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "lead-sub-efforts-documents delete policy" ON storage.objects;

-- Step 3: Policies for authenticated users
CREATE POLICY "lead-sub-efforts-documents upload policy" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lead-sub-efforts-documents');

CREATE POLICY "lead-sub-efforts-documents select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'lead-sub-efforts-documents');

CREATE POLICY "lead-sub-efforts-documents update policy" ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'lead-sub-efforts-documents')
WITH CHECK (bucket_id = 'lead-sub-efforts-documents');

CREATE POLICY "lead-sub-efforts-documents delete policy" ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'lead-sub-efforts-documents');

-- Optional: verify
SELECT id, name, public, file_size_limit, created_at
FROM storage.buckets
WHERE id = 'lead-sub-efforts-documents';

