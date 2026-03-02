-- Set language_id = 1 for all leads where the language (text) column is "English".
-- Run in Supabase SQL editor. Safe to re-run (idempotent).
-- Requires: leads.language_id column and misc_language.id = 1 exists (e.g. for "English").
-- If "English" has a different id in misc_language, change 1 to that id below.

UPDATE public.leads
SET language_id = 1
WHERE language IS NOT NULL
  AND TRIM(language) <> ''
  AND LOWER(TRIM(language)) = 'english'
  AND (language_id IS DISTINCT FROM 1);
