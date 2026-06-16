-- Remote work flag for employees (admin Employee manager toggle).

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS works_from_home boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants_employee.works_from_home IS
  'Whether the employee works from home (remote).';
