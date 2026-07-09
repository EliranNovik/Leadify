-- Add optional description to sub_efforts templates.
-- Run in Supabase SQL editor.

ALTER TABLE public.sub_efforts
  ADD COLUMN IF NOT EXISTS description text NULL;

COMMENT ON COLUMN public.sub_efforts.description IS
  'Optional longer explanation shown in admin and CRM sub-effort workflow.';
