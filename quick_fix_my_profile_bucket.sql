-- Quick fix for My-Profile bucket CORS issues
-- Run this to immediately fix the image display problem

-- Step 1: Drop any existing policies for My-Profile bucket
DROP POLICY IF EXISTS "My-Profile upload policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile select policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile update policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile delete policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile public select policy" ON storage.objects;
DROP POLICY IF EXISTS "My-Profile allow all" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to upload to My-Profile" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to view My-Profile images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update My-Profile images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete My-Profile images" ON storage.objects;

-- Step 2: Ensure bucket exists and is public
INSERT INTO storage.buckets (id, name, public) 
VALUES ('My-Profile', 'My-Profile', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Step 3: Create very permissive policies
CREATE POLICY "My-Profile allow all" ON storage.objects
FOR ALL 
TO public
USING (bucket_id = 'My-Profile')
WITH CHECK (bucket_id = 'My-Profile');

-- Step 4: Verify bucket is public
SELECT id, name, public FROM storage.buckets WHERE id = 'My-Profile';

-- Step 5: Test by checking if we can see files
SELECT name, bucket_id, created_at FROM storage.objects WHERE bucket_id = 'My-Profile' ORDER BY created_at DESC LIMIT 5;
