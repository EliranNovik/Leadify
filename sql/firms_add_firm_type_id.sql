-- =============================================================================
-- Add firm_type_id to firms (existing DBs that ran an older firms script)
-- =============================================================================
-- Run once if public.firms exists without firm_type_id. Safe: IF NOT EXISTS.
-- Requires public.firm_types to exist first.
-- =============================================================================

ALTER TABLE public.firms
    ADD COLUMN IF NOT EXISTS firm_type_id uuid REFERENCES public.firm_types (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firms_firm_type ON public.firms (firm_type_id);

COMMENT ON COLUMN public.firms.firm_type_id IS 'Primary firm type (see also firm_firm_type for many-to-many).';
