-- Add department column to employees table
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS department TEXT;

-- Add a foreign key constraint to link employees.department to departments.name
-- First, ensure the departments table has a unique constraint on the name column if it doesn't already
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_name_unique') THEN
        ALTER TABLE departments ADD CONSTRAINT departments_name_unique UNIQUE (name);
    END IF;
END $$;

-- Add the foreign key constraint
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_department_fkey') THEN
        ALTER TABLE employees ADD CONSTRAINT employees_department_fkey 
        FOREIGN KEY (department) REFERENCES departments(name) ON DELETE SET NULL;
    END IF;
END $$;

-- Add an index on the department column for better query performance
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);

-- Add a comment to document the new column
COMMENT ON COLUMN employees.department IS 'Department name - references departments.name';

-- Update RLS policies if needed (assuming employees table has RLS enabled)
-- This ensures users can read/write the department field
-- Note: Adjust these policies based on your existing RLS setup

-- Example RLS policy for reading employees with department (adjust as needed)
-- CREATE POLICY IF NOT EXISTS "Users can view employees with department" ON employees
--     FOR SELECT USING (true);

-- Example RLS policy for updating employees with department (adjust as needed)
-- CREATE POLICY IF NOT EXISTS "Users can update employees with department" ON employees
--     FOR UPDATE USING (true);

-- Example RLS policy for inserting employees with department (adjust as needed)
-- CREATE POLICY IF NOT EXISTS "Users can insert employees with department" ON employees
--     FOR INSERT WITH CHECK (true);
