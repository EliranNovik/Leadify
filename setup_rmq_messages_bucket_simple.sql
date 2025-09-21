-- Simple setup for RMQ-MESSAGES bucket policies
-- Run this in your Supabase SQL editor

-- 1. First, check if bucket exists and make it public
UPDATE storage.buckets SET public = true WHERE name = 'RMQ-MESSAGES';

-- 2. Create basic storage policies for RMQ-MESSAGES bucket

-- Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload to RMQ-MESSAGES"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'RMQ-MESSAGES');

-- Allow authenticated users to view/download files
CREATE POLICY "Allow authenticated users to view RMQ-MESSAGES files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES');

-- Allow authenticated users to update files
CREATE POLICY "Allow authenticated users to update RMQ-MESSAGES files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES');

-- Allow authenticated users to delete files
CREATE POLICY "Allow authenticated users to delete RMQ-MESSAGES files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES');

-- 3. Verify setup
SELECT 
  name as bucket_name,
  public as is_public
FROM storage.buckets 
WHERE name = 'RMQ-MESSAGES';
