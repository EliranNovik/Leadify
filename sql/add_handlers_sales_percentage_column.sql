-- Add handlers_sales_percentage column to employee_field_assignments table
-- This column stores the percentage for Handlers or Sales role per field
-- It allows field_percentage to be NULL when handlers_sales_percentage is provided

-- Add the new column
ALTER TABLE public.employee_field_assignments 
ADD COLUMN IF NOT EXISTS handlers_sales_percentage NUMERIC(5,2) CHECK (
    handlers_sales_percentage IS NULL OR 
    (handlers_sales_percentage >= 0 AND handlers_sales_percentage <= 100)
);

-- Update the field_percentage constraint to allow NULL when handlers_sales_percentage is provided
-- First, drop the existing NOT NULL constraint if it exists
ALTER TABLE public.employee_field_assignments 
ALTER COLUMN field_percentage DROP NOT NULL;

-- Add a check constraint to ensure at least one percentage is provided
ALTER TABLE public.employee_field_assignments 
DROP CONSTRAINT IF EXISTS check_percentage_provided;

ALTER TABLE public.employee_field_assignments 
ADD CONSTRAINT check_percentage_provided CHECK (
    (field_percentage IS NOT NULL) OR 
    (handlers_sales_percentage IS NOT NULL)
);

-- Update the existing field_percentage check constraint to allow NULL
ALTER TABLE public.employee_field_assignments 
DROP CONSTRAINT IF EXISTS employee_field_assignments_field_percentage_check;

ALTER TABLE public.employee_field_assignments 
ADD CONSTRAINT employee_field_assignments_field_percentage_check 
CHECK (
    field_percentage IS NULL OR 
    (field_percentage >= 0 AND field_percentage <= 100)
);

-- Add comment for documentation
COMMENT ON COLUMN public.employee_field_assignments.handlers_sales_percentage IS 
'Percentage for Handlers or Sales role per field. When provided, field_percentage can be NULL. Used for fixed contribution calculations.';
