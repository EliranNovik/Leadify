-- Sub effort template columns: sort_order + percentage.
-- Category links live in public.sub_effort_misc_categories
-- (run 2026-07-09_sub_effort_misc_categories_junction.sql).
-- Run in Supabase SQL editor.

ALTER TABLE public.sub_efforts
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage numeric(5, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sub_efforts.sort_order IS
  'Display order among sub effort templates (0 = first).';

COMMENT ON COLUMN public.sub_efforts.percentage IS
  'Weight share for this sub effort (0–100).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sub_efforts_percentage_range_chk'
  ) THEN
    ALTER TABLE public.sub_efforts
      ADD CONSTRAINT sub_efforts_percentage_range_chk
      CHECK (percentage >= 0 AND percentage <= 100);
  END IF;
END;
$$;

-- Backfill sort_order for existing rows (stable by name, then id).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (ORDER BY name ASC, id ASC) - 1 AS rn
  FROM public.sub_efforts
)
UPDATE public.sub_efforts AS se
SET sort_order = ranked.rn
FROM ranked
WHERE se.id = ranked.id
  AND se.sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_sub_efforts_sort_order
  ON public.sub_efforts USING btree (sort_order);
