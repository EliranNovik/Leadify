-- Backfill leads.category_id from leads.category (text) by matching to misc_category.name.
-- Uses case-insensitive, trimmed comparison. Where misc_category has duplicate names, picks the
-- smallest id per name.
-- Run in Supabase SQL editor or: psql $DATABASE_URL -f sql/leads_category_text_to_category_id.sql

-- Step 0: Preview (run alone to see what will be updated)
-- SELECT l.id, l.lead_number, l.category AS lead_category, mc.id AS category_id, mc.name AS category_name
-- FROM public.leads l
-- JOIN public.misc_category mc ON LOWER(TRIM(l.category)) = LOWER(TRIM(mc.name))
-- WHERE l.category IS NOT NULL AND TRIM(l.category) <> ''
-- ORDER BY l.id
-- LIMIT 100;

-- Step 1: Update leads

-- One row per normalized category name (pick smallest id if duplicates)
WITH match AS (
  SELECT DISTINCT ON (LOWER(TRIM(name))) id, LOWER(TRIM(name)) AS norm_name
  FROM public.misc_category
  WHERE name IS NOT NULL AND TRIM(name) <> ''
  ORDER BY LOWER(TRIM(name)), id
)
UPDATE public.leads l
SET category_id = match.id
FROM match
WHERE LOWER(TRIM(l.category)) = match.norm_name
  AND l.category IS NOT NULL
  AND TRIM(l.category) <> '';

-- Optional: same for leads_lead if it has category + category_id
-- WITH match AS (
--   SELECT DISTINCT ON (LOWER(TRIM(name))) id, LOWER(TRIM(name)) AS norm_name
--   FROM public.misc_category
--   WHERE name IS NOT NULL AND TRIM(name) <> ''
--   ORDER BY LOWER(TRIM(name)), id
-- )
-- UPDATE public.leads_lead l
-- SET category_id = match.id
-- FROM match
-- WHERE LOWER(TRIM(l.category)) = match.norm_name
--   AND l.category IS NOT NULL
--   AND TRIM(l.category) <> '';
