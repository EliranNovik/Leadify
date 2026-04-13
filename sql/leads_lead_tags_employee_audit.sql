-- =============================================================================
-- leads_lead_tags: who tagged and when (audit on junction rows)
-- =============================================================================
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS / guarded DO blocks).
-- Frontend sends employee_id (tenants_employee.id) + tagged_at on each insert.
-- =============================================================================

ALTER TABLE public.leads_lead_tags
  ADD COLUMN IF NOT EXISTS employee_id BIGINT NULL;

ALTER TABLE public.leads_lead_tags
  ADD COLUMN IF NOT EXISTS tagged_at TIMESTAMPTZ NULL DEFAULT now();

COMMENT ON COLUMN public.leads_lead_tags.employee_id IS 'tenants_employee.id of the user who last assigned this tag row (from users.employee_id at save time)';
COMMENT ON COLUMN public.leads_lead_tags.tagged_at IS 'When this tag assignment was written (re-set on each save that re-inserts the row)';

-- Optional: backfill historical rows (otherwise tagged_at stays NULL until next save re-inserts)
-- UPDATE public.leads_lead_tags SET tagged_at = now() WHERE tagged_at IS NULL;

-- FK: employee_id -> tenants_employee(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'leads_lead_tags'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'employee_id'
      AND ccu.table_name = 'tenants_employee'
      AND ccu.column_name = 'id'
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT leads_lead_tags_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.tenants_employee (id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_employee_id
  ON public.leads_lead_tags (employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_tagged_at
  ON public.leads_lead_tags (tagged_at DESC)
  WHERE tagged_at IS NOT NULL;

ANALYZE public.leads_lead_tags;
