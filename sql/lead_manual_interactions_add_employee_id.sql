-- Link manual interactions to tenants_employee (optional FK).
-- Run after sql/create_lead_manual_interactions_table.sql

ALTER TABLE public.lead_manual_interactions
  ADD COLUMN IF NOT EXISTS employee_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lead_manual_interactions_employee_id_fkey'
  ) THEN
    ALTER TABLE public.lead_manual_interactions
      ADD CONSTRAINT lead_manual_interactions_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.tenants_employee(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_manual_interactions_employee_id
  ON public.lead_manual_interactions (employee_id)
  WHERE employee_id IS NOT NULL;

COMMENT ON COLUMN public.lead_manual_interactions.employee_id IS
  'Optional FK to tenants_employee. employee (text) should match display_name for stats/timeline.';
