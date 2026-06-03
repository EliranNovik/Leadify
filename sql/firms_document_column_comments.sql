-- Clarify firms document columns store storage paths in their buckets
-- Run after create_firm_contracts_bucket.sql, create_firm_invoice_documents_bucket.sql,
-- and create_firms_other_documents_bucket.sql

COMMENT ON COLUMN public.firms.invoices IS 'Storage path in firm-invoice-documents bucket (firm profile invoices).';
COMMENT ON COLUMN public.firms.other_docs IS 'Storage path in firms_other_documents bucket.';
