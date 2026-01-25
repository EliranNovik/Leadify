-- Create table for employee unavailability reasons
-- This table stores detailed reasons for unavailability with document support for sick days

CREATE TABLE IF NOT EXISTS employee_unavailability_reasons (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES tenants_employee(id) ON DELETE CASCADE,
  unavailability_type VARCHAR(20) NOT NULL CHECK (unavailability_type IN ('sick_days', 'vacation', 'general')),
  sick_days_reason TEXT,
  vacation_reason TEXT,
  general_reason TEXT,
  document_url TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_employee_unavailability_reasons_employee_id ON employee_unavailability_reasons(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_unavailability_reasons_dates ON employee_unavailability_reasons(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_employee_unavailability_reasons_type ON employee_unavailability_reasons(unavailability_type);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_employee_unavailability_reasons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_employee_unavailability_reasons_updated_at
  BEFORE UPDATE ON employee_unavailability_reasons
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_unavailability_reasons_updated_at();

-- Add comment
COMMENT ON TABLE employee_unavailability_reasons IS 'Stores detailed reasons for employee unavailability including sick days, vacation, and general reasons with document support';
