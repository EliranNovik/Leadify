-- =============================================================================
-- Second firm contract slot + clarify contract columns store storage paths
-- =============================================================================
-- Run after sql/create_firm_contracts_bucket.sql (bucket: firm-contracts).
-- =============================================================================

ALTER TABLE public.firms ADD COLUMN IF NOT EXISTS contract_2 text;

COMMENT ON COLUMN public.firms.contract IS 'Storage path in firm-contracts bucket (primary contract).';
COMMENT ON COLUMN public.firms.contract_2 IS 'Storage path in firm-contracts bucket (second contract).';
