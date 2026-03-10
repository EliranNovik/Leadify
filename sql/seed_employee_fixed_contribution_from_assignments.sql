-- Seed employee_fixed_contribution with one row per (employee_id, department_role)
-- from employee_field_assignments where department_role is Sales, Handlers, Partners, Marketing, or Finance
-- and the assignment is active. Existing rows in employee_fixed_contribution are left unchanged.
-- Run add_sales_to_employee_fixed_contribution.sql first so Sales (and other roles) are allowed.

INSERT INTO public.employee_fixed_contribution (employee_id, department_role, fixed_contribution_amount)
SELECT DISTINCT efa.employee_id, efa.department_role, 0
FROM public.employee_field_assignments efa
WHERE efa.department_role IN ('Sales', 'Handlers', 'Partners', 'Marketing', 'Finance')
  AND (efa.is_active IS NULL OR efa.is_active = true)
ON CONFLICT (employee_id, department_role) DO NOTHING;
