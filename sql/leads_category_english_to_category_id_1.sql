-- Set category_id = 1 for all leads where the category (text) column contains "English".
-- Matches: "English", "English (US)", etc. Run once; safe to re-run (idempotent).
-- Requires: leads.category_id column and misc_category.id = 1 exists (e.g. "English" or desired category).

UPDATE public.leads
SET category_id = 1
WHERE category IS NOT NULL
  AND TRIM(category) <> ''
  AND LOWER(TRIM(category)) LIKE '%english%'
  AND (category_id IS DISTINCT FROM 1);
