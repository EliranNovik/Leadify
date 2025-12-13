-- Create RMQ-Groups storage bucket for group chat icons
-- This bucket stores custom icons/avatars for group conversations

-- Step 1: Ensure the bucket exists and is properly configured
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'RMQ-Groups', 
  'RMQ-Groups', 
  true, 
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

-- Step 2: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "RMQ-Groups upload policy" ON storage.objects;
DROP POLICY IF EXISTS "RMQ-Groups select policy" ON storage.objects;
DROP POLICY IF EXISTS "RMQ-Groups update policy" ON storage.objects;
DROP POLICY IF EXISTS "RMQ-Groups delete policy" ON storage.objects;

-- Step 3: Create new policies for authenticated users
CREATE POLICY "RMQ-Groups upload policy" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'RMQ-Groups');

CREATE POLICY "RMQ-Groups select policy" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'RMQ-Groups');

CREATE POLICY "RMQ-Groups update policy" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'RMQ-Groups')
WITH CHECK (bucket_id = 'RMQ-Groups');

CREATE POLICY "RMQ-Groups delete policy" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'RMQ-Groups');

-- Step 4: Also allow public access for viewing (since bucket is public)
CREATE POLICY "RMQ-Groups public select policy" ON storage.objects
FOR SELECT 
TO anon
USING (bucket_id = 'RMQ-Groups');

-- Step 5: Verify the bucket configuration
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets 
WHERE id = 'RMQ-Groups';

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
  AND policyname LIKE 'RMQ-Groups%'
ORDER BY policyname;

