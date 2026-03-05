-- =============================================================================
-- Unactivation notes & case inactive badge: indexes + FK to misc_reason
-- =============================================================================
-- Adds indexes for unactivated_at, unactivation_reason, deactivate_notes, status,
-- and reason_id so queries and joins are fast. Adds FK from leads_lead.reason_id
-- to misc_reason(id) so the app can join for reason name instead of using a map.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Indexes on leads (new leads) – unactivation and deactivate notes
-- -----------------------------------------------------------------------------
-- (idx_leads_unactivated_at and idx_leads_unactivation_reason may already exist
-- from add_unactivation_columns.sql; IF NOT EXISTS keeps this script idempotent.)

CREATE INDEX IF NOT EXISTS idx_leads_unactivated_at
  ON public.leads (unactivated_at)
  WHERE unactivated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_unactivation_reason
  ON public.leads (unactivation_reason)
  WHERE unactivation_reason IS NOT NULL;

-- (deactivate_notes not indexed: values can exceed btree row size; used for display only.)

-- -----------------------------------------------------------------------------
-- 2. Indexes on leads_lead (legacy) – unactivation, status, reason_id
-- -----------------------------------------------------------------------------
-- status: used for "case inactive" badge (e.g. status = 10)
-- reason_id: used for join to misc_reason to get reason name (replaces map)
-- (deactivate_notes not indexed: values can exceed btree row size; used for display only.)

CREATE INDEX IF NOT EXISTS idx_leads_lead_unactivated_at
  ON public.leads_lead (unactivated_at)
  WHERE unactivated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_unactivation_reason
  ON public.leads_lead (unactivation_reason)
  WHERE unactivation_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_status
  ON public.leads_lead (status);

-- For join: leads_lead.reason_id -> misc_reason(id) (case inactive badge)
CREATE INDEX IF NOT EXISTS idx_leads_lead_reason_id
  ON public.leads_lead (reason_id)
  WHERE reason_id IS NOT NULL;

-- Composite for "inactive legacy leads in date range" (reports)
CREATE INDEX IF NOT EXISTS idx_leads_lead_unactivated_at_range
  ON public.leads_lead (unactivated_at)
  WHERE unactivated_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. misc_reason: index for active filter (optional, for dropdowns)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_misc_reason_active
  ON public.misc_reason (active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_misc_reason_order
  ON public.misc_reason ("order")
  WHERE "order" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Foreign key: leads_lead.reason_id -> misc_reason(id)
-- -----------------------------------------------------------------------------
-- So the app can join misc_reason for the reason name instead of using a map.
-- If reason_id is TEXT, it is converted to INTEGER to match misc_reason(id).

DO $$
DECLARE
  col_type text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.leads_lead'::regclass
      AND conname = 'fk_leads_lead_reason_id'
      AND contype = 'f'
  ) THEN
    -- Ensure reason_id type matches misc_reason(id) (integer)
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'reason_id';

    IF col_type IN ('text', 'character varying', 'varchar', 'character') THEN
      ALTER TABLE public.leads_lead
        ALTER COLUMN reason_id TYPE integer
        USING (NULLIF(TRIM(reason_id), '')::integer);
      RAISE NOTICE 'Converted leads_lead.reason_id from % to integer', col_type;
    ELSIF col_type = 'bigint' THEN
      -- Optional: narrow to integer if all values fit (misc_reason.id is integer)
      -- ALTER TABLE public.leads_lead ALTER COLUMN reason_id TYPE integer USING reason_id::integer;
      NULL; -- keep bigint; FK from bigint to integer is allowed in PostgreSQL
    END IF;

    -- Null out any reason_id that does not exist in misc_reason
    UPDATE public.leads_lead ll
    SET reason_id = NULL
    WHERE ll.reason_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.misc_reason r WHERE r.id = ll.reason_id::integer);

    ALTER TABLE public.leads_lead
      ADD CONSTRAINT fk_leads_lead_reason_id
      FOREIGN KEY (reason_id)
      REFERENCES public.misc_reason (id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
    RAISE NOTICE 'Added fk_leads_lead_reason_id';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Optional: if leads (new leads) ever gets reason_id, add FK there too
-- -----------------------------------------------------------------------------
-- Uncomment and run if you add reason_id to leads:
--
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'reason_id'
--   ) AND NOT EXISTS (
--     SELECT 1 FROM pg_constraint
--     WHERE conrelid = 'public.leads'::regclass AND conname = 'fk_leads_reason_id' AND contype = 'f'
--   ) THEN
--     ALTER TABLE public.leads
--       ADD CONSTRAINT fk_leads_reason_id
--       FOREIGN KEY (reason_id)
--       REFERENCES public.misc_reason (id)
--       ON DELETE SET NULL
--       ON UPDATE CASCADE;
--     CREATE INDEX IF NOT EXISTS idx_leads_reason_id ON public.leads (reason_id) WHERE reason_id IS NOT NULL;
--   END IF;
-- END $$;
