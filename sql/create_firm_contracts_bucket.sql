-- Private bucket for firm contract documents (paths stored in firms.contract / firms.contract_2)
-- Run after firms.contract column exists (see firms_add_legal_vat_website_address_docs.sql)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-contracts',
  'firm-contracts',
  false,
  15728640, -- 15 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "firm-contracts insert" ON storage.objects;
DROP POLICY IF EXISTS "firm-contracts select" ON storage.objects;
DROP POLICY IF EXISTS "firm-contracts update" ON storage.objects;
DROP POLICY IF EXISTS "firm-contracts delete" ON storage.objects;

CREATE POLICY "firm-contracts insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firm-contracts');

CREATE POLICY "firm-contracts select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firm-contracts');

CREATE POLICY "firm-contracts update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firm-contracts')
  WITH CHECK (bucket_id = 'firm-contracts');

CREATE POLICY "firm-contracts delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firm-contracts');
