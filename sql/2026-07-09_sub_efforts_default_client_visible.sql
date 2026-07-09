-- Default client visibility for sub effort templates.
-- true  = new lead_sub_efforts rows are visible to the client (internal = false)
-- false = new lead_sub_efforts rows are internal only (internal = true)
-- Run in Supabase SQL editor.

ALTER TABLE public.sub_efforts
  ADD COLUMN IF NOT EXISTS default_client_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sub_efforts.default_client_visible IS
  'When true, auto-provisioned lead_sub_efforts rows default to client-visible (internal = false).';
