-- Public bucket for firm + firm_contact profile images (staff via authenticated policies)
-- Paths: firms/<firm_id>/<timestamp>.<ext>  |  contacts/<contact_id>/<timestamp>.<ext>
-- If INSERT into storage.buckets fails, create bucket "firm-profile-images" in Dashboard (Public, 5MB, image/*).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-profile-images',
  'firm-profile-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "firm-profile-images public read" ON storage.objects;
DROP POLICY IF EXISTS "firm-profile-images insert" ON storage.objects;
DROP POLICY IF EXISTS "firm-profile-images update" ON storage.objects;
DROP POLICY IF EXISTS "firm-profile-images delete" ON storage.objects;

CREATE POLICY "firm-profile-images public read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'firm-profile-images');

CREATE POLICY "firm-profile-images insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'firm-profile-images');

CREATE POLICY "firm-profile-images update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'firm-profile-images')
WITH CHECK (bucket_id = 'firm-profile-images');

CREATE POLICY "firm-profile-images delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'firm-profile-images');
