-- Create employee_field_assignments table
-- This table stores employee assignments to fields (categories) with their field percentage and department role
-- Each employee can have multiple field assignments (multiple rows)

CREATE TABLE IF NOT EXISTS public.employee_field_assignments (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES public.misc_maincategory(id) ON DELETE CASCADE,
    field_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (field_percentage >= 0 AND field_percentage <= 100),
    department_role VARCHAR(50) CHECK (department_role IS NULL OR department_role IN ('Sales', 'Handlers', 'Partners', 'Marketing', 'Finance')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
    
    -- Note: Multiple records allowed for same employee_id + field_id combination
    -- to support different department roles per field
    -- Unique constraint removed to allow multiple department roles per employee-field combination
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employee_field_assignments_employee_id 
    ON public.employee_field_assignments(employee_id);
    
CREATE INDEX IF NOT EXISTS idx_employee_field_assignments_field_id 
    ON public.employee_field_assignments(field_id);
    
CREATE INDEX IF NOT EXISTS idx_employee_field_assignments_department_role 
    ON public.employee_field_assignments(department_role);
    
CREATE INDEX IF NOT EXISTS idx_employee_field_assignments_active 
    ON public.employee_field_assignments(is_active) WHERE is_active = TRUE;

-- Create function to update updated_at timestamp (idempotent)
CREATE OR REPLACE FUNCTION update_employee_field_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_update_employee_field_assignments_updated_at ON public.employee_field_assignments;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_employee_field_assignments_updated_at
    BEFORE UPDATE ON public.employee_field_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_employee_field_assignments_updated_at();

-- Enable Row Level Security
ALTER TABLE public.employee_field_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Allow authenticated users to view employee field assignments" ON public.employee_field_assignments;
DROP POLICY IF EXISTS "Allow authenticated users to insert employee field assignments" ON public.employee_field_assignments;
DROP POLICY IF EXISTS "Allow authenticated users to update employee field assignments" ON public.employee_field_assignments;
DROP POLICY IF EXISTS "Allow authenticated users to delete employee field assignments" ON public.employee_field_assignments;

-- Policy: Allow authenticated users to view all assignments
CREATE POLICY "Allow authenticated users to view employee field assignments"
    ON public.employee_field_assignments
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow authenticated users to insert assignments
CREATE POLICY "Allow authenticated users to insert employee field assignments"
    ON public.employee_field_assignments
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy: Allow authenticated users to update assignments
CREATE POLICY "Allow authenticated users to update employee field assignments"
    ON public.employee_field_assignments
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy: Allow authenticated users to delete assignments
CREATE POLICY "Allow authenticated users to delete employee field assignments"
    ON public.employee_field_assignments
    FOR DELETE
    TO authenticated
    USING (true);

-- Add comments for documentation
COMMENT ON TABLE public.employee_field_assignments IS 'Stores employee assignments to fields (categories) with field percentage and department role. Each employee can have multiple field assignments.';
COMMENT ON COLUMN public.employee_field_assignments.employee_id IS 'Reference to tenants_employee table';
COMMENT ON COLUMN public.employee_field_assignments.field_id IS 'Reference to misc_maincategory table (the field/category)';
COMMENT ON COLUMN public.employee_field_assignments.field_percentage IS 'The percentage allocation for this employee in this field (0-100)';
COMMENT ON COLUMN public.employee_field_assignments.department_role IS 'The department role for this assignment (Sales, Handlers, Partners, Marketing, Finance)';
COMMENT ON COLUMN public.employee_field_assignments.is_active IS 'Whether this assignment is currently active';
