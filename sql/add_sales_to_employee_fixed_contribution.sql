-- Add 'Sales' to allowed department_role in employee_fixed_contribution
-- so the Fixed Contribution modal can store amounts for Sales (from employee_field_assignments).
-- Run this before seed_sales_employee_fixed_contribution.sql.

ALTER TABLE public.employee_fixed_contribution
  DROP CONSTRAINT IF EXISTS employee_fixed_contribution_department_role_check;

ALTER TABLE public.employee_fixed_contribution
  ADD CONSTRAINT employee_fixed_contribution_department_role_check
  CHECK (department_role IN ('Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'));

COMMENT ON TABLE public.employee_fixed_contribution IS 'Fixed contribution amount per employee per department role (Sales, Handlers, Partners, Marketing, Finance).';
