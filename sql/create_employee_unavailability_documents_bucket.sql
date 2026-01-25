-- Create storage bucket for employee unavailability documents (sick day documents)
-- This bucket stores doctor's notes and medical documents for sick day requests

-- Step 1: Ensure the bucket exists and is properly configured
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'employee-unavailability-documents', 
  'employee-unavailability-documents', 
  false, -- Private bucket (only authenticated users can access)
  10485760, -- 10MB limit for documents
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

-- Step 2: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "employee-unavailability-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-unavailability-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-unavailability-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "employee-unavailability-documents delete policy" ON storage.objects;

-- Step 3: Create policies for authenticated users
-- Allow authenticated users to upload their own documents
CREATE POLICY "employee-unavailability-documents upload policy" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'employee-unavailability-documents');

-- Allow authenticated users to view/download documents
CREATE POLICY "employee-unavailability-documents select policy" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'employee-unavailability-documents');

-- Allow authenticated users to update their own documents
CREATE POLICY "employee-unavailability-documents update policy" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'employee-unavailability-documents')
WITH CHECK (bucket_id = 'employee-unavailability-documents');

-- Allow authenticated users to delete their own documents
CREATE POLICY "employee-unavailability-documents delete policy" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'employee-unavailability-documents');

-- Step 4: Verify the bucket configuration
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets 
WHERE id = 'employee-unavailability-documents';

-- Step 5: Verify the policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'objects' 
  AND policyname LIKE '%employee-unavailability-documents%';
