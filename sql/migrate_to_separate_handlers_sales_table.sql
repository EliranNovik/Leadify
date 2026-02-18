-- Migration script to move handlers_sales_percentage data to separate table
-- and remove the column from employee_field_assignments

-- Step 1: Create the new table (run create_employee_handlers_sales_contributions_table.sql first)

-- Step 2: Migrate existing data from employee_field_assignments to the new table
INSERT INTO public.employee_handlers_sales_contributions (
    employee_id,
    field_id,
    handlers_sales_percentage,
    department_role,
    is_active,
    created_at,
    updated_at
)
SELECT 
    employee_id,
    field_id,
    handlers_sales_percentage,
    department_role,
    is_active,
    created_at,
    updated_at
FROM public.employee_field_assignments
WHERE handlers_sales_percentage IS NOT NULL
  AND department_role IN ('Handlers', 'Sales')
ON CONFLICT (employee_id, field_id, department_role) DO NOTHING;

-- Step 3: Delete the migrated records from employee_field_assignments
DELETE FROM public.employee_field_assignments
WHERE handlers_sales_percentage IS NOT NULL;

-- Step 4: Remove the handlers_sales_percentage column and related constraints
ALTER TABLE public.employee_field_assignments
DROP COLUMN IF EXISTS handlers_sales_percentage;

-- Step 5: Make field_percentage NOT NULL again (since we no longer need NULL values)
-- First, set any NULL values to 0
UPDATE public.employee_field_assignments
SET field_percentage = 0
WHERE field_percentage IS NULL;

-- Then make it NOT NULL
ALTER TABLE public.employee_field_assignments
ALTER COLUMN field_percentage SET NOT NULL;

-- Step 6: Drop the constraint that was checking for either field_percentage or handlers_sales_percentage
ALTER TABLE public.employee_field_assignments
DROP CONSTRAINT IF EXISTS chk_percentage_not_null;
