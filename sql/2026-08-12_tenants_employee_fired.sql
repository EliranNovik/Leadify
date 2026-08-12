-- End employment / termination flag on tenants_employee.

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS fired boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS fired_at timestamptz NULL;

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS fired_by_employee_id bigint NULL;

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS fired_by_name text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_employee_fired_by_employee_id_fkey'
  ) THEN
    ALTER TABLE public.tenants_employee
      ADD CONSTRAINT tenants_employee_fired_by_employee_id_fkey
      FOREIGN KEY (fired_by_employee_id)
      REFERENCES public.tenants_employee(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.tenants_employee.fired IS
  'Whether employment has been ended (terminated).';

COMMENT ON COLUMN public.tenants_employee.fired_at IS
  'When employment was ended.';

COMMENT ON COLUMN public.tenants_employee.fired_by_employee_id IS
  'Employee who marked employment as ended.';

COMMENT ON COLUMN public.tenants_employee.fired_by_name IS
  'Display name snapshot of who ended employment.';

CREATE INDEX IF NOT EXISTS tenants_employee_fired_idx
  ON public.tenants_employee (fired)
  WHERE fired = true;
