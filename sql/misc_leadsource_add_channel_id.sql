-- =============================================================================
-- Link lead sources (misc_leadsource) to marketing channels (public.channels)
-- =============================================================================
-- Requires public.channels from sql/firms_types_channels_contacts.sql.
-- Run in Supabase SQL Editor once.
-- =============================================================================

ALTER TABLE public.misc_leadsource
    ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.channels (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_misc_leadsource_channel_id ON public.misc_leadsource (channel_id);

COMMENT ON COLUMN public.misc_leadsource.channel_id IS 'Optional link to firm channel catalog (Google, Facebook, …).';
