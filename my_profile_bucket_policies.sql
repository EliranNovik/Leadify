-- Create My-Profile bucket policies for employee background images
-- This file contains the necessary RLS policies for the My-Profile storage bucket

-- First, ensure the My-Profile bucket exists (run this if the bucket doesn't exist yet)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('My-Profile', 'My-Profile', true);

-- Policy 1: Allow authenticated users to upload images to My-Profile bucket
CREATE POLICY "Allow authenticated users to upload to My-Profile" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'My-Profile' AND auth.uid() IS NOT NULL);

-- Policy 2: Allow authenticated users to view images in My-Profile bucket
CREATE POLICY "Allow authenticated users to view My-Profile images" ON storage.objects
FOR SELECT 
TO authenticated
USING (bucket_id = 'My-Profile' AND auth.uid() IS NOT NULL);

-- Policy 3: Allow authenticated users to update their own images in My-Profile bucket
CREATE POLICY "Allow authenticated users to update My-Profile images" ON storage.objects
FOR UPDATE 
TO authenticated
USING (bucket_id = 'My-Profile' AND auth.uid() IS NOT NULL)
WITH CHECK (bucket_id = 'My-Profile' AND auth.uid() IS NOT NULL);

-- Policy 4: Allow authenticated users to delete their own images in My-Profile bucket
CREATE POLICY "Allow authenticated users to delete My-Profile images" ON storage.objects
FOR DELETE 
TO authenticated
USING (bucket_id = 'My-Profile' AND auth.uid() IS NOT NULL);

-- Alternative: More restrictive policies that check if the user owns the file
-- Uncomment these if you want to restrict users to only their own files

-- Policy 1 (Restrictive): Allow users to upload only files with their user ID in the filename
-- CREATE POLICY "Allow users to upload their own files to My-Profile" ON storage.objects
-- FOR INSERT 
-- TO authenticated
-- WITH CHECK (
--   bucket_id = 'My-Profile' 
--   AND auth.uid() IS NOT NULL
--   AND (storage.foldername(name))[1] = 'My-Profile'
--   AND (storage.filename(name)) LIKE auth.uid()::text || '_%'
-- );

-- Policy 2 (Restrictive): Allow users to view only their own files
-- CREATE POLICY "Allow users to view their own My-Profile files" ON storage.objects
-- FOR SELECT 
-- TO authenticated
-- USING (
--   bucket_id = 'My-Profile' 
--   AND auth.uid() IS NOT NULL
--   AND (storage.filename(name)) LIKE auth.uid()::text || '_%'
-- );

-- Policy 3 (Restrictive): Allow users to update only their own files
-- CREATE POLICY "Allow users to update their own My-Profile files" ON storage.objects
-- FOR UPDATE 
-- TO authenticated
-- USING (
--   bucket_id = 'My-Profile' 
--   AND auth.uid() IS NOT NULL
--   AND (storage.filename(name)) LIKE auth.uid()::text || '_%'
-- )
-- WITH CHECK (
--   bucket_id = 'My-Profile' 
--   AND auth.uid() IS NOT NULL
--   AND (storage.filename(name)) LIKE auth.uid()::text || '_%'
-- );

-- Policy 4 (Restrictive): Allow users to delete only their own files
-- CREATE POLICY "Allow users to delete their own My-Profile files" ON storage.objects
-- FOR DELETE 
-- TO authenticated
-- USING (
--   bucket_id = 'My-Profile' 
--   AND auth.uid() IS NOT NULL
--   AND (storage.filename(name)) LIKE auth.uid()::text || '_%'
-- );

-- Note: The current implementation uses employee ID in the filename, not user ID
-- If you want to use user ID instead, you'll need to modify the uploadImageToStorage function
-- to use auth.uid() instead of employee.id

-- To check if policies are working, you can run:
-- SELECT * FROM storage.objects WHERE bucket_id = 'My-Profile';
-- SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
