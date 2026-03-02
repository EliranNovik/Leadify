-- Ensure foreign key exists for misc_maincategory.department_id -> tenant_departement(id)
-- so Supabase/PostgREST can embed tenant_departement in misc_maincategory queries (dashboard
-- can use join instead of mapping code for category -> department).
-- Run this once; safe to re-run (constraint is only added if missing).
--
-- Step 1: Null out orphaned department_id in misc_maincategory where the referenced id does not exist.
-- Step 2: Add the constraint if missing.

-- ========== Step 1: Fix orphaned references ==========

-- misc_maincategory: set department_id to NULL where the referenced row does not exist in tenant_departement
UPDATE public.misc_maincategory
SET department_id = NULL
WHERE department_id IS NOT NULL
  AND department_id NOT IN (SELECT id FROM public.tenant_departement);

-- ========== Step 2: Add constraint (misc_maincategory -> tenant_departement) ==========

-- department_id -> tenant_departement(id)
-- PostgREST will expose this as embeddable, e.g. misc_maincategory with tenant_departement!fk_misc_maincategory_department_id(id, name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.misc_maincategory'::regclass
      AND conname = 'fk_misc_maincategory_department_id'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.misc_maincategory
      ADD CONSTRAINT fk_misc_maincategory_department_id
      FOREIGN KEY (department_id) REFERENCES public.tenant_departement(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Optional: index for faster lookups when joining/filtering by department_id
CREATE INDEX IF NOT EXISTS idx_misc_maincategory_department_id
  ON public.misc_maincategory(department_id);
