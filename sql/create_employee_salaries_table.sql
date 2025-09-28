-- Create employee_salaries table
CREATE TABLE IF NOT EXISTS employee_salaries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES tenants_employee(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    salary_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency_id UUID REFERENCES currencies(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by BIGINT REFERENCES auth_user(id),
    updated_by BIGINT REFERENCES auth_user(id),
    
    -- Ensure one salary record per employee per month/year
    UNIQUE(employee_id, year, month)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employee_salaries_employee_id ON employee_salaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_year_month ON employee_salaries(year, month);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_employee_year_month ON employee_salaries(employee_id, year, month);

-- Add RLS (Row Level Security) policies
ALTER TABLE employee_salaries ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to read salaries
CREATE POLICY "Allow authenticated users to read salaries" ON employee_salaries
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy to allow authenticated users to insert salaries
CREATE POLICY "Allow authenticated users to insert salaries" ON employee_salaries
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy to allow authenticated users to update salaries
CREATE POLICY "Allow authenticated users to update salaries" ON employee_salaries
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy to allow authenticated users to delete salaries
CREATE POLICY "Allow authenticated users to delete salaries" ON employee_salaries
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_employee_salaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_employee_salaries_updated_at
    BEFORE UPDATE ON employee_salaries
    FOR EACH ROW
    EXECUTE FUNCTION update_employee_salaries_updated_at();

-- Add comments for documentation
COMMENT ON TABLE employee_salaries IS 'Stores monthly salary information for employees';
COMMENT ON COLUMN employee_salaries.employee_id IS 'Reference to the employee';
COMMENT ON COLUMN employee_salaries.year IS 'Year for the salary record';
COMMENT ON COLUMN employee_salaries.month IS 'Month for the salary record (1-12)';
COMMENT ON COLUMN employee_salaries.salary_amount IS 'Salary amount for the month';
COMMENT ON COLUMN employee_salaries.currency_id IS 'Currency for the salary amount';
COMMENT ON COLUMN employee_salaries.created_by IS 'User who created the record';
COMMENT ON COLUMN employee_salaries.updated_by IS 'User who last updated the record';
