-- Add 'Handlers' to allowed department_role in employee_fixed_contribution
-- so the Fixed Contribution modal can store amounts for Handlers (from employee_field_assignments).

ALTER TABLE public.employee_fixed_contribution
  DROP CONSTRAINT IF EXISTS employee_fixed_contribution_department_role_check;

ALTER TABLE public.employee_fixed_contribution
  ADD CONSTRAINT employee_fixed_contribution_department_role_check
  CHECK (department_role IN ('Partners', 'Marketing', 'Finance', 'Handlers'));

COMMENT ON TABLE public.employee_fixed_contribution IS 'Fixed contribution amount per employee per department role (Partners, Marketing, Finance, Handlers).';
