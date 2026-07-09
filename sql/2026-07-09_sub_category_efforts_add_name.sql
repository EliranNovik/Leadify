-- Add short label `name` to sub_category_efforts (description stays for longer text).
-- Run in Supabase SQL editor.

ALTER TABLE public.sub_category_efforts
  ADD COLUMN IF NOT EXISTS name text NULL;

COMMENT ON COLUMN public.sub_category_efforts.name IS
  'Short display name for this sub-category effort step.';

COMMENT ON COLUMN public.sub_category_efforts.description IS
  'Longer explanatory text for this sub-category effort step.';

-- Backfill name from first line of description where missing.
UPDATE public.sub_category_efforts
SET name = NULLIF(trim(split_part(description, E'\n', 1)), '')
WHERE (name IS NULL OR trim(name) = '')
  AND description IS NOT NULL
  AND trim(description) <> '';

UPDATE public.sub_category_efforts
SET name = 'Sub-category ' || id::text
WHERE name IS NULL OR trim(name) = '';

ALTER TABLE public.sub_category_efforts
  ALTER COLUMN name SET NOT NULL;
