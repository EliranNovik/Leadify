-- Private buckets for firm_management_costs.payment_confirmation and .tax_receipt
-- Run after sql/firm_management_costs_add_payment_tax_docs.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-management-payment-confirmations',
  'firm-management-payment-confirmations',
  false,
  15728640,
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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firm-management-tax-receipts',
  'firm-management-tax-receipts',
  false,
  15728640,
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

-- Payment confirmations bucket policies
DROP POLICY IF EXISTS "firm-management-payment-confirmations insert" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-payment-confirmations select" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-payment-confirmations update" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-payment-confirmations delete" ON storage.objects;

CREATE POLICY "firm-management-payment-confirmations insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firm-management-payment-confirmations');

CREATE POLICY "firm-management-payment-confirmations select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firm-management-payment-confirmations');

CREATE POLICY "firm-management-payment-confirmations update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firm-management-payment-confirmations')
  WITH CHECK (bucket_id = 'firm-management-payment-confirmations');

CREATE POLICY "firm-management-payment-confirmations delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firm-management-payment-confirmations');

-- Tax receipts bucket policies
DROP POLICY IF EXISTS "firm-management-tax-receipts insert" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-tax-receipts select" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-tax-receipts update" ON storage.objects;
DROP POLICY IF EXISTS "firm-management-tax-receipts delete" ON storage.objects;

CREATE POLICY "firm-management-tax-receipts insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'firm-management-tax-receipts');

CREATE POLICY "firm-management-tax-receipts select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'firm-management-tax-receipts');

CREATE POLICY "firm-management-tax-receipts update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'firm-management-tax-receipts')
  WITH CHECK (bucket_id = 'firm-management-tax-receipts');

CREATE POLICY "firm-management-tax-receipts delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'firm-management-tax-receipts');
