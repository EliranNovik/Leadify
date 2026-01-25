-- Add worker_id column to tenants_employee table
-- This ID corresponds to the employee number (מספר עובד) from payroll documents
ALTER TABLE public.tenants_employee
ADD COLUMN IF NOT EXISTS worker_id text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenants_employee_worker_id ON public.tenants_employee(worker_id);

-- Add comment
COMMENT ON COLUMN public.tenants_employee.worker_id IS 'Employee number from payroll system (מספר עובד) - used to match payroll documents';
