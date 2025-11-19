-- Purpose: allow Facebook/webhook integrations to use larger numeric source codes
-- Run this in your Supabase/PG console before deploying the updated backend.
BEGIN;

-- Expand misc_leadsource.code from smallint to integer
ALTER TABLE public.misc_leadsource
  ALTER COLUMN code TYPE integer
  USING code::integer;

COMMIT;

