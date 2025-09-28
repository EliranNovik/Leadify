-- Fix My-Profile bucket CORS and configuration issues
-- Run this to resolve the "OpaqueResponseBlocking" and image display issues

-- Step 1: Ensure the bucket exists and is properly configured
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'My-Profile', 
  'My-Profile', 
  true, 
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

-- Step 2: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "My-Profile upload policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile select policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile update policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile delete policy" ON storage.objects;

-- Step 3: Create new, more permissive policies
CREATE POLICY "My-Profile upload policy" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'My-Profile');

CREATE POLICY "My-Profile select policy" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'My-Profile');

CREATE POLICY "My-Profile update policy" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'My-Profile')
WITH CHECK (bucket_id = 'My-Profile');

CREATE POLICY "My-Profile delete policy" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'My-Profile');

-- Step 4: Also allow public access for viewing (since bucket is public)
CREATE POLICY "My-Profile public select policy" ON storage.objects
FOR SELECT 
TO anon
USING (bucket_id = 'My-Profile');

-- Step 5: Verify the bucket configuration
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets 
WHERE id = 'My-Profile';

-- Step 6: Verify the policies were created
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
AND schemaname = 'storage'
AND policyname LIKE '%My-Profile%';

-- Step 7: Check if there are any existing files in the bucket
SELECT 
  name,
  bucket_id,
  created_at,
  updated_at,
  metadata
FROM storage.objects 
WHERE bucket_id = 'My-Profile'
ORDER BY created_at DESC;
