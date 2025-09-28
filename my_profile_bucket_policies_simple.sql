-- Simple My-Profile bucket policies for employee background images
-- This version is more permissive and should work with the current implementation

-- Step 1: Create the My-Profile bucket (run this first if bucket doesn't exist)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('My-Profile', 'My-Profile', true)
ON CONFLICT (id) DO NOTHING;

-- Step 1.5: Make sure the bucket is public and has proper CORS settings
UPDATE storage.buckets 
SET public = true 
WHERE id = 'My-Profile';

-- Step 2: Create the RLS policies

-- Policy 1: Allow authenticated users to upload to My-Profile bucket
CREATE POLICY "My-Profile upload policy" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'My-Profile');

-- Policy 2: Allow authenticated users to view images in My-Profile bucket
CREATE POLICY "My-Profile select policy" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'My-Profile');

-- Policy 3: Allow authenticated users to update images in My-Profile bucket
CREATE POLICY "My-Profile update policy" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'My-Profile')
WITH CHECK (bucket_id = 'My-Profile');

-- Policy 4: Allow authenticated users to delete images in My-Profile bucket
CREATE POLICY "My-Profile delete policy" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'My-Profile');

-- Verify the policies were created
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
