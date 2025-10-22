-- Add user_id column to tenants_employee table
-- This will allow connecting employees with users from the users table

-- Step 1: Add the user_id column
ALTER TABLE public.tenants_employee 
ADD COLUMN user_id bigint;

-- Step 2: Add foreign key constraint to users table
ALTER TABLE public.tenants_employee 
ADD CONSTRAINT fk_tenants_employee_user_id 
FOREIGN KEY (user_id) 
REFERENCES public.users(id) 
ON DELETE SET NULL 
ON UPDATE CASCADE;

-- Step 3: Add index for better performance
CREATE INDEX IF NOT EXISTS idx_tenants_employee_user_id 
ON public.tenants_employee(user_id) 
WHERE user_id IS NOT NULL;

-- Step 4: Add comment to document the column
COMMENT ON COLUMN public.tenants_employee.user_id IS 'Foreign key reference to users table for connecting employees with system users';
