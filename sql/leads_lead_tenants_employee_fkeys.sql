-- Ensure foreign keys exist from public.leads_lead to public.tenants_employee for all
-- employee role columns, so Supabase/PostgREST can embed tenants_employee in leads_lead
-- queries (e.g. Signed Sales Report, Dashboard, Case Manager).
-- Run once; safe to re-run (constraints are only added if missing).
--
-- Only adds FKs for columns that are already type bigint. No type conversion.
--
-- Step 1: Null out orphaned IDs in leads_lead where the referenced id does not exist in tenants_employee.
-- Step 2: Add each FK constraint if missing (only when the column is type bigint).
-- Step 3: Create indexes on FK columns for join performance.

-- ========== Step 1: Fix orphaned references ==========

-- leads_lead: set each employee role column to NULL where the referenced row does not exist in tenants_employee.
-- Use ::text in NOT IN so this works whether the column is text or bigint (avoids "operator text = bigint" error).
UPDATE public.leads_lead
SET case_handler_id = NULL
WHERE case_handler_id IS NOT NULL
  AND case_handler_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

UPDATE public.leads_lead
SET closer_id = NULL
WHERE closer_id IS NOT NULL
  AND closer_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

UPDATE public.leads_lead
SET meeting_scheduler_id = NULL
WHERE meeting_scheduler_id IS NOT NULL
  AND meeting_scheduler_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

UPDATE public.leads_lead
SET meeting_manager_id = NULL
WHERE meeting_manager_id IS NOT NULL
  AND meeting_manager_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

UPDATE public.leads_lead
SET meeting_lawyer_id = NULL
WHERE meeting_lawyer_id IS NOT NULL
  AND meeting_lawyer_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

UPDATE public.leads_lead
SET expert_id = NULL
WHERE expert_id IS NOT NULL
  AND expert_id::text NOT IN (SELECT id::text FROM public.tenants_employee);

-- Optional columns (only if they exist) — use dynamic SQL to avoid errors when column is missing.
-- Compare using id::text so both text and bigint FK columns work (no operator text = bigint).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'exclusive_handler_id') THEN
    EXECUTE 'UPDATE public.leads_lead SET exclusive_handler_id = NULL WHERE exclusive_handler_id IS NOT NULL AND exclusive_handler_id::text NOT IN (SELECT id::text FROM public.tenants_employee)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'anchor_id') THEN
    EXECUTE 'UPDATE public.leads_lead SET anchor_id = NULL WHERE anchor_id IS NOT NULL AND anchor_id::text NOT IN (SELECT id::text FROM public.tenants_employee)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'retainer_handler_id') THEN
    EXECUTE 'UPDATE public.leads_lead SET retainer_handler_id = NULL WHERE retainer_handler_id IS NOT NULL AND retainer_handler_id::text NOT IN (SELECT id::text FROM public.tenants_employee)';
  END IF;
END $$;

-- ========== Step 2: Add constraints (leads_lead -> tenants_employee) ==========
-- Only for columns that are already type bigint; text columns are skipped.

DO $$
DECLARE
  col_type text;
BEGIN
  -- case_handler_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'case_handler_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_case_handler_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_case_handler_id FOREIGN KEY (case_handler_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_case_handler_id';
  END IF;

  -- closer_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'closer_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_closer_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_closer_id FOREIGN KEY (closer_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_closer_id';
  END IF;

  -- meeting_scheduler_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'meeting_scheduler_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_meeting_scheduler_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_meeting_scheduler_id FOREIGN KEY (meeting_scheduler_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_meeting_scheduler_id';
  END IF;

  -- meeting_manager_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'meeting_manager_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_meeting_manager_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_meeting_manager_id FOREIGN KEY (meeting_manager_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_meeting_manager_id';
  END IF;

  -- meeting_lawyer_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'meeting_lawyer_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_meeting_lawyer_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_meeting_lawyer_id FOREIGN KEY (meeting_lawyer_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_meeting_lawyer_id';
  END IF;

  -- expert_id
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'expert_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_expert_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_expert_id FOREIGN KEY (expert_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_expert_id';
  END IF;

  -- exclusive_handler_id (if column exists and is bigint)
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'exclusive_handler_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_exclusive_handler_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_exclusive_handler_id FOREIGN KEY (exclusive_handler_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_exclusive_handler_id';
  END IF;

  -- anchor_id (if column exists and is bigint)
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'anchor_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_anchor_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_anchor_id FOREIGN KEY (anchor_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_anchor_id';
  END IF;

  -- retainer_handler_id (if column exists and is bigint)
  SELECT data_type INTO col_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'retainer_handler_id';
  IF col_type = 'bigint' AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.leads_lead'::regclass AND conname = 'fk_leads_lead_retainer_handler_id' AND contype = 'f') THEN
    ALTER TABLE public.leads_lead ADD CONSTRAINT fk_leads_lead_retainer_handler_id FOREIGN KEY (retainer_handler_id) REFERENCES public.tenants_employee(id) ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_retainer_handler_id';
  END IF;
END $$;

-- ========== Step 3: Indexes for JOIN performance ==========

CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_id ON public.leads_lead(case_handler_id) WHERE case_handler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_id ON public.leads_lead(closer_id) WHERE closer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_scheduler_id ON public.leads_lead(meeting_scheduler_id) WHERE meeting_scheduler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_manager_id ON public.leads_lead(meeting_manager_id) WHERE meeting_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_lawyer_id ON public.leads_lead(meeting_lawyer_id) WHERE meeting_lawyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_id ON public.leads_lead(expert_id) WHERE expert_id IS NOT NULL;
