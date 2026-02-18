-- Create employee_handlers_sales_contributions table
-- This table stores fixed contribution percentages for Handlers or Sales roles per field
-- Separate from employee_field_assignments to avoid complexity

CREATE TABLE IF NOT EXISTS public.employee_handlers_sales_contributions (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES public.misc_maincategory(id) ON DELETE CASCADE,
    handlers_sales_percentage NUMERIC(5,2) NOT NULL CHECK (handlers_sales_percentage >= 0 AND handlers_sales_percentage <= 100),
    department_role VARCHAR(50) NOT NULL CHECK (department_role IN ('Handlers', 'Sales')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    -- Allow multiple records per employee-field-role combination for flexibility
    -- But typically one per employee-field-role
    UNIQUE(employee_id, field_id, department_role)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employee_handlers_sales_contributions_employee_id 
    ON public.employee_handlers_sales_contributions(employee_id);
    
CREATE INDEX IF NOT EXISTS idx_employee_handlers_sales_contributions_field_id 
    ON public.employee_handlers_sales_contributions(field_id);
    
CREATE INDEX IF NOT EXISTS idx_employee_handlers_sales_contributions_department_role 
    ON public.employee_handlers_sales_contributions(department_role);
    
CREATE INDEX IF NOT EXISTS idx_employee_handlers_sales_contributions_active 
    ON public.employee_handlers_sales_contributions(is_active) WHERE is_active = TRUE;

-- Create function to update updated_at timestamp (idempotent)
CREATE OR REPLACE FUNCTION update_employee_handlers_sales_contributions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_update_employee_handlers_sales_contributions_updated_at 
    ON public.employee_handlers_sales_contributions;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_employee_handlers_sales_contributions_updated_at
    BEFORE UPDATE ON public.employee_handlers_sales_contributions
    FOR EACH ROW
    EXECUTE FUNCTION update_employee_handlers_sales_contributions_updated_at();

-- Enable Row Level Security
ALTER TABLE public.employee_handlers_sales_contributions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Allow authenticated users to view employee handlers sales contributions" 
    ON public.employee_handlers_sales_contributions;
DROP POLICY IF EXISTS "Allow authenticated users to insert employee handlers sales contributions" 
    ON public.employee_handlers_sales_contributions;
DROP POLICY IF EXISTS "Allow authenticated users to update employee handlers sales contributions" 
    ON public.employee_handlers_sales_contributions;
DROP POLICY IF EXISTS "Allow authenticated users to delete employee handlers sales contributions" 
    ON public.employee_handlers_sales_contributions;

-- Policy: Allow authenticated users to view all contributions
CREATE POLICY "Allow authenticated users to view employee handlers sales contributions"
    ON public.employee_handlers_sales_contributions
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow authenticated users to insert contributions
CREATE POLICY "Allow authenticated users to insert employee handlers sales contributions"
    ON public.employee_handlers_sales_contributions
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy: Allow authenticated users to update contributions
CREATE POLICY "Allow authenticated users to update employee handlers sales contributions"
    ON public.employee_handlers_sales_contributions
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy: Allow authenticated users to delete contributions
CREATE POLICY "Allow authenticated users to delete employee handlers sales contributions"
    ON public.employee_handlers_sales_contributions
    FOR DELETE
    TO authenticated
    USING (true);

-- Add comments for documentation
COMMENT ON TABLE public.employee_handlers_sales_contributions IS 'Stores fixed contribution percentages for Handlers or Sales roles per field. Separate from employee_field_assignments for clarity.';
COMMENT ON COLUMN public.employee_handlers_sales_contributions.employee_id IS 'Reference to tenants_employee table';
COMMENT ON COLUMN public.employee_handlers_sales_contributions.field_id IS 'Reference to misc_maincategory table (the field/category)';
COMMENT ON COLUMN public.employee_handlers_sales_contributions.handlers_sales_percentage IS 'The fixed contribution percentage for Handlers or Sales role in this field (0-100)';
COMMENT ON COLUMN public.employee_handlers_sales_contributions.department_role IS 'The department role for this contribution (Handlers or Sales only)';
COMMENT ON COLUMN public.employee_handlers_sales_contributions.is_active IS 'Whether this contribution is currently active';
