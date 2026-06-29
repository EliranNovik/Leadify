-- Payper tax invoice-receipt fields on payment_links (run in Supabase SQL editor)
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS pelecard_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS payper_invoice_link TEXT,
  ADD COLUMN IF NOT EXISTS payper_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS payper_document_system_id BIGINT,
  ADD COLUMN IF NOT EXISTS payper_invoice_status TEXT,
  ADD COLUMN IF NOT EXISTS payper_raw_response JSONB,
  ADD COLUMN IF NOT EXISTS payper_invoice_created_at TIMESTAMPTZ;

COMMENT ON COLUMN payment_links.pelecard_customer_id IS 'Israeli ID / passport entered at Pelecard checkout (CustomerIdField)';
COMMENT ON COLUMN payment_links.payper_invoice_link IS 'Public Payper invoice view URL (InvoiceLink)';
COMMENT ON COLUMN payment_links.payper_invoice_number IS 'Payper assigned invoice number (InvoiceNumber)';
COMMENT ON COLUMN payment_links.payper_document_system_id IS 'Payper document_system_id for refund Credit/Receipt chain';
COMMENT ON COLUMN payment_links.payper_invoice_status IS 'pending | success | failed | skipped';
COMMENT ON COLUMN payment_links.payper_raw_response IS 'CreatePayperInvoice request/response audit JSON';
