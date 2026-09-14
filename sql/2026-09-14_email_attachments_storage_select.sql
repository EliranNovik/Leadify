-- Authenticated staff can create signed URLs for persisted email files
-- so Sequence of Events / sub-effort pickers can preview them in the CRM.
-- Backend still writes with the service role. Bucket stays private.

DROP POLICY IF EXISTS "email-attachments select policy" ON storage.objects;
CREATE POLICY "email-attachments select policy" ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'email-attachments');
