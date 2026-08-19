-- Add display name for Sent by / Received from on saved interactions.
-- Safe to re-run.

ALTER TABLE public.lead_pinned_interactions
  ADD COLUMN IF NOT EXISTS party_name text;

COMMENT ON COLUMN public.lead_pinned_interactions.party_name IS
  'Display name for Sent by (outgoing) or Received from (incoming); not a raw email address.';
