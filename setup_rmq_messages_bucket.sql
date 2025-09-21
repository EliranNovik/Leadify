-- Setup policies for RMQ-MESSAGES bucket
-- Run this in your Supabase SQL editor

-- 1. Create storage policies for RMQ-MESSAGES bucket

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

-- Allow authenticated users to update their own files (if needed)
CREATE POLICY "Allow authenticated users to update their own RMQ-MESSAGES files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow authenticated users to delete their own files (if needed)
CREATE POLICY "Allow authenticated users to delete their own RMQ-MESSAGES files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 2. Alternative: More permissive policies if the above don't work
-- Uncomment these if you need more permissive access

-- CREATE POLICY "Allow all authenticated users full access to RMQ-MESSAGES"
-- ON storage.objects FOR ALL
-- TO authenticated
-- USING (bucket_id = 'RMQ-MESSAGES');

-- 3. Verify bucket exists and is public
-- Check if the bucket exists
SELECT name, public FROM storage.buckets WHERE name = 'RMQ-MESSAGES';

-- If bucket is not public, make it public
-- UPDATE storage.buckets SET public = true WHERE name = 'RMQ-MESSAGES';

-- 4. Test the policies
-- This should return the bucket info if everything is set up correctly
SELECT 
  b.name as bucket_name,
  b.public as is_public,
  COUNT(p.policyname) as policy_count
FROM storage.buckets b
LEFT JOIN pg_policies p ON p.tablename = 'objects' AND p.policyname LIKE '%RMQ-MESSAGES%'
WHERE b.name = 'RMQ-MESSAGES'
GROUP BY b.name, b.public;
