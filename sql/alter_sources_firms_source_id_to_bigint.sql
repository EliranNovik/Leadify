-- Purpose: allow linking firms to misc_leadsource rows with large numeric ids (e.g. 1763540565273)
-- Fixes: "value ... is out of range for type integer" when inserting into sources_firms
--
-- IMPORTANT:
-- - This assumes `public.misc_leadsource.id` is already `bigint` (or at least compatible).
-- - Run this in Supabase SQL editor with sufficient privileges.

BEGIN;

-- Drop FK so we can change the type
ALTER TABLE public.sources_firms
  DROP CONSTRAINT IF EXISTS sources_firms_source_id_fkey;

-- Change type to bigint
ALTER TABLE public.sources_firms
  ALTER COLUMN source_id TYPE bigint
  USING source_id::bigint;

-- Recreate FK to misc_leadsource(id)
ALTER TABLE public.sources_firms
  ADD CONSTRAINT sources_firms_source_id_fkey
  FOREIGN KEY (source_id)
  REFERENCES public.misc_leadsource (id)
  ON DELETE CASCADE;

-- Recreate index (safe if exists)
CREATE INDEX IF NOT EXISTS idx_sources_firms_source ON public.sources_firms (source_id);

COMMIT;

