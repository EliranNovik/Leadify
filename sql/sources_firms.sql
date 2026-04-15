-- =============================================================================
-- sources_firms: many lead sources (misc_leadsource) per firm (provider)
-- =============================================================================
-- Links marketing/report "provider" to the same source_ids used on leads.
-- Run order:
--   1. sql/firms_types_channels_contacts.sql (firms + misc_leadsource must exist)
--   2. This file
--   3. Re-run or merge sql/firms_channels_rls_authenticated.sql (policies for sources_firms)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sources_firms (
    firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
    -- Use bigint because misc_leadsource IDs may be large (e.g. webhook-generated codes / timestamps)
    source_id bigint NOT NULL REFERENCES public.misc_leadsource (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (firm_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_sources_firms_source ON public.sources_firms (source_id);

COMMENT ON TABLE public.sources_firms IS 'Which lead sources (campaigns) belong to which provider firm; used for marketing provider filter.';
COMMENT ON COLUMN public.sources_firms.source_id IS 'Must match misc_leadsource.id (PostgreSQL bigint).';
