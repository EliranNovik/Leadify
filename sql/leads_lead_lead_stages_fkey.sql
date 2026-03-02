-- Ensure foreign keys exist from stage columns to public.lead_stages(id)
-- so Supabase/PostgREST can embed lead_stages (id, name, colour) in leads_lead and leads
-- queries for stage badge and stage logic without separate lookups.
-- Run once; safe to re-run.
--
-- Step 1: Fix orphaned references (leads_lead, then leads if stage is bigint).
-- Step 2: Add FK constraints if missing.
-- Step 3: Indexes for join performance.

-- ========== Step 1: Fix orphaned references ==========

-- leads_lead
UPDATE public.leads_lead
SET stage = NULL
WHERE stage IS NOT NULL
  AND stage NOT IN (SELECT id FROM public.lead_stages);

-- leads (new leads): only when stage column is bigint/integer so FK is valid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'stage'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    EXECUTE 'UPDATE public.leads SET stage = NULL WHERE stage IS NOT NULL AND stage NOT IN (SELECT id FROM public.lead_stages)';
  END IF;
END $$;

-- ========== Step 2: Add constraints ==========

-- leads_lead.stage -> lead_stages.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads_lead'::regclass
      AND conname = 'fk_leads_lead_stage'
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.leads_lead
      ADD CONSTRAINT fk_leads_lead_stage
      FOREIGN KEY (stage) REFERENCES public.lead_stages(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
    RAISE NOTICE 'Added fk_leads_lead_stage';
  END IF;
END $$;

-- leads.stage -> lead_stages.id (only when leads.stage is bigint)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'stage'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.leads'::regclass
        AND conname = 'fk_leads_stage'
        AND contype = 'f'
    ) THEN
      ALTER TABLE public.leads
        ADD CONSTRAINT fk_leads_stage
        FOREIGN KEY (stage) REFERENCES public.lead_stages(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      RAISE NOTICE 'Added fk_leads_stage';
    END IF;
  END IF;
END $$;

-- ========== Step 3: Indexes for join performance ==========

CREATE INDEX IF NOT EXISTS idx_leads_lead_stage ON public.leads_lead(stage) WHERE stage IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'stage') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage) WHERE stage IS NOT NULL;
  END IF;
END $$;
