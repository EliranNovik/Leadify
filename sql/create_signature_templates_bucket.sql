-- Create signature-templates bucket for storing signature template images
-- This bucket will store images used in company signature templates

-- Step 1: Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'signature-templates', 
  'signature-templates', 
  true, 
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

-- Step 2: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "signature-templates upload policy" ON storage.objects;
DROP POLICY IF EXISTS "signature-templates select policy" ON storage.objects;
DROP POLICY IF EXISTS "signature-templates update policy" ON storage.objects;
DROP POLICY IF EXISTS "signature-templates delete policy" ON storage.objects;
DROP POLICY IF EXISTS "signature-templates public select policy" ON storage.objects;

-- Step 3: Create policies for authenticated users
CREATE POLICY "signature-templates upload policy" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'signature-templates');

CREATE POLICY "signature-templates select policy" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'signature-templates');

CREATE POLICY "signature-templates update policy" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'signature-templates')
WITH CHECK (bucket_id = 'signature-templates');

CREATE POLICY "signature-templates delete policy" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'signature-templates');

-- Step 4: Allow public access for viewing (since bucket is public)
CREATE POLICY "signature-templates public select policy" ON storage.objects
FOR SELECT 
TO anon
USING (bucket_id = 'signature-templates');

-- Step 5: Verify the bucket configuration
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets 
WHERE id = 'signature-templates';

-- Step 6: Verify the policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'objects' 
AND schemaname = 'storage'
AND policyname LIKE '%signature-templates%';

