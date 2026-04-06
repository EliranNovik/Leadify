-- =============================================================================
-- Add legal / VAT / web / address / document columns to public.firms
-- =============================================================================
-- For databases created before these columns existed. Safe to re-run.
-- =============================================================================

ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS contract text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS invoices text;
ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS other_docs text;

COMMENT ON COLUMN public.firms.contract IS 'Contract doc URL/path or reference.';
COMMENT ON COLUMN public.firms.invoices IS 'Invoices doc URL/path or reference.';
COMMENT ON COLUMN public.firms.other_docs IS 'Other documents URL/path or reference.';
