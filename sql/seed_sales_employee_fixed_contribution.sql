-- Transfer all employees with department_role = 'Sales' from employee_field_assignments
-- into employee_fixed_contribution with fixed_contribution_amount = 0.
-- Run add_sales_to_employee_fixed_contribution.sql first so Sales is allowed.

INSERT INTO public.employee_fixed_contribution (employee_id, department_role, fixed_contribution_amount)
SELECT DISTINCT efa.employee_id, efa.department_role, 0
FROM public.employee_field_assignments efa
WHERE efa.department_role = 'Sales'
  AND (efa.is_active IS NULL OR efa.is_active = true)
ON CONFLICT (employee_id, department_role) DO NOTHING;
