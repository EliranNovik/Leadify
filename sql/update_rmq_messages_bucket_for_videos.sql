-- Update RMQ-MESSAGES bucket to support large video files
-- This ensures the bucket can handle videos up to 200MB
-- NOTE: Supabase Free tier has a 50MB limit. Pro tier allows up to 5GB per file.
-- If you're on Free tier and get errors, reduce to 52428800 (50MB)

-- Step 1: First, ensure the bucket exists (create if it doesn't)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'RMQ-MESSAGES', 
  'RMQ-MESSAGES', 
  true, 
  209715200, -- 200MB in bytes (52428800 = 50MB for Free tier, 104857600 = 100MB, 209715200 = 200MB)
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/zip', 'application/x-rar-compressed',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
  ]
)
ON CONFLICT (id) DO UPDATE SET 
  file_size_limit = 209715200, -- 200MB (adjust based on your Supabase plan: 52428800=50MB, 104857600=100MB, 209715200=200MB)
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'application/zip', 'application/x-rar-compressed',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
  ],
  public = true;

-- Step 2: Ensure bucket is public (if needed for public access)
UPDATE storage.buckets SET public = true WHERE name = 'RMQ-MESSAGES';

-- Step 3: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Allow authenticated users to upload to RMQ-MESSAGES" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to view RMQ-MESSAGES files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update their own RMQ-MESSAGES files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete their own RMQ-MESSAGES files" ON storage.objects;
DROP POLICY IF EXISTS "RMQ-MESSAGES public select policy" ON storage.objects;

-- Step 4: Create/Recreate policies for authenticated users
CREATE POLICY "Allow authenticated users to upload to RMQ-MESSAGES"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'RMQ-MESSAGES');

CREATE POLICY "Allow authenticated users to view RMQ-MESSAGES files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES');

CREATE POLICY "Allow authenticated users to update their own RMQ-MESSAGES files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES')
WITH CHECK (bucket_id = 'RMQ-MESSAGES');

CREATE POLICY "Allow authenticated users to delete their own RMQ-MESSAGES files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'RMQ-MESSAGES');

-- Step 5: Also allow public access for viewing (since bucket is public)
CREATE POLICY "RMQ-MESSAGES public select policy" ON storage.objects
FOR SELECT 
TO anon
USING (bucket_id = 'RMQ-MESSAGES');

-- Step 6: Verify the bucket configuration
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets 
WHERE name = 'RMQ-MESSAGES';

-- Step 7: Verify the policies were created
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
AND policyname LIKE '%RMQ-MESSAGES%';

