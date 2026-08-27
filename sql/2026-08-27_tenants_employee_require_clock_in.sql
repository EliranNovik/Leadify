-- Per-employee CRM clock-in gate. Default off: staff can use the system without clocking in.
-- When true, the employee must clock in before accessing the CRM (same as the previous global gate).

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS require_clock_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants_employee.require_clock_in IS
  'When true, this employee must clock in before using the CRM. Default false (optional clock-in).';
