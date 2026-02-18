-- Drop the unique constraint on (employee_id, field_id) to allow multiple department roles
-- This allows the same employee to have multiple records for the same field with different department roles

ALTER TABLE public.employee_field_assignments 
DROP CONSTRAINT IF EXISTS uq_employee_field;
