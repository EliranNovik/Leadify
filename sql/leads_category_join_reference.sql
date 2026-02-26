-- Ensure foreign keys exist for category_id, source_id, and language_id so Supabase/PostgREST
-- can embed misc_category, misc_leadsource, and misc_language in lead queries (faster load, no client-side mapping).
-- Run this once; safe to re-run (constraints are only added if missing).
--
-- Step 1: Null out orphaned IDs so the FK can be added (rows where the referenced id does not exist).
-- Step 2: Add the constraints if missing.

-- ========== Step 1: Fix orphaned references ==========

-- leads: set source_id/category_id/language_id to NULL where the referenced row does not exist
UPDATE public.leads
SET source_id = NULL
WHERE source_id IS NOT NULL
  AND source_id NOT IN (SELECT id FROM public.misc_leadsource);

UPDATE public.leads
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM public.misc_category);

UPDATE public.leads
SET language_id = NULL
WHERE language_id IS NOT NULL
  AND language_id NOT IN (SELECT id FROM public.misc_language);

-- leads_lead: same
UPDATE public.leads_lead
SET source_id = NULL
WHERE source_id IS NOT NULL
  AND source_id NOT IN (SELECT id FROM public.misc_leadsource);

UPDATE public.leads_lead
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM public.misc_category);

UPDATE public.leads_lead
SET language_id = NULL
WHERE language_id IS NOT NULL
  AND language_id NOT IN (SELECT id FROM public.misc_language);

-- ========== Step 2: Add constraints (leads) ==========

-- category_id -> misc_category(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND conname = 'fk_leads_category_id'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT fk_leads_category_id
      FOREIGN KEY (category_id) REFERENCES public.misc_category(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- source_id -> misc_leadsource(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND conname = 'fk_leads_source_id'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT fk_leads_source_id
      FOREIGN KEY (source_id) REFERENCES public.misc_leadsource(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- language_id -> misc_language(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND conname = 'fk_leads_language_id'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT fk_leads_language_id
      FOREIGN KEY (language_id) REFERENCES public.misc_language(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- ========== leads_lead (legacy leads table) ==========

-- category_id -> misc_category(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads_lead'::regclass
      AND conname = 'leads_lead_category_id_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads_lead
      ADD CONSTRAINT leads_lead_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.misc_category(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- source_id -> misc_leadsource(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads_lead'::regclass
      AND conname = 'leads_lead_source_id_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads_lead
      ADD CONSTRAINT leads_lead_source_id_fkey
      FOREIGN KEY (source_id) REFERENCES public.misc_leadsource(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- language_id -> misc_language(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads_lead'::regclass
      AND conname = 'leads_lead_language_id_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads_lead
      ADD CONSTRAINT leads_lead_language_id_fkey
      FOREIGN KEY (language_id) REFERENCES public.misc_language(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;
