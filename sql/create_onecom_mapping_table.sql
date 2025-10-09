-- Create 1com mapping table for extensions and phone numbers
-- This table maps 1com extension numbers and phone numbers to employee IDs

CREATE TABLE IF NOT EXISTS onecom_employee_mapping (
    id SERIAL PRIMARY KEY,
    onecom_extension VARCHAR(50) NOT NULL,  -- Extension from 1com (e.g., '849-decker', '231-decker')
    onecom_phone VARCHAR(50),               -- Phone number from 1com (e.g., '0526945577', '0536223118')
    employee_id INTEGER NOT NULL,           -- Reference to tenants_employee.id
    employee_name VARCHAR(255),             -- Employee name for reference
    mapping_type VARCHAR(20) NOT NULL,      -- 'extension' or 'phone'
    is_active BOOLEAN DEFAULT TRUE,         -- Whether this mapping is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_onecom_mapping_employee 
        FOREIGN KEY (employee_id) 
        REFERENCES tenants_employee(id) 
        ON DELETE CASCADE,
    
    -- Unique constraints
    CONSTRAINT uq_onecom_extension UNIQUE (onecom_extension),
    CONSTRAINT uq_onecom_phone UNIQUE (onecom_phone),
    
    -- Check constraints
    CONSTRAINT chk_mapping_type CHECK (mapping_type IN ('extension', 'phone')),
    CONSTRAINT chk_has_value CHECK (
        (mapping_type = 'extension' AND onecom_extension IS NOT NULL) OR
        (mapping_type = 'phone' AND onecom_phone IS NOT NULL)
    )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_onecom_mapping_extension 
    ON onecom_employee_mapping(onecom_extension) WHERE onecom_extension IS NOT NULL;
    
CREATE INDEX IF NOT EXISTS idx_onecom_mapping_phone 
    ON onecom_employee_mapping(onecom_phone) WHERE onecom_phone IS NOT NULL;
    
CREATE INDEX IF NOT EXISTS idx_onecom_mapping_employee 
    ON onecom_employee_mapping(employee_id);

CREATE INDEX IF NOT EXISTS idx_onecom_mapping_active 
    ON onecom_employee_mapping(is_active) WHERE is_active = TRUE;

-- Add comments
COMMENT ON TABLE onecom_employee_mapping IS 'Maps 1com extension numbers and phone numbers to employee IDs for call log attribution';
COMMENT ON COLUMN onecom_employee_mapping.onecom_extension IS '1com extension number (e.g., 849-decker, 231-decker)';
COMMENT ON COLUMN onecom_employee_mapping.onecom_phone IS '1com phone number (e.g., 0526945577, 0536223118)';
COMMENT ON COLUMN onecom_employee_mapping.employee_id IS 'Reference to tenants_employee.id';
COMMENT ON COLUMN onecom_employee_mapping.employee_name IS 'Employee name for reference (denormalized for performance)';
COMMENT ON COLUMN onecom_employee_mapping.mapping_type IS 'Type of mapping: extension or phone';

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_onecom_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_onecom_mapping_updated_at
    BEFORE UPDATE ON onecom_employee_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_onecom_mapping_updated_at();

-- Create view for easy querying
CREATE OR REPLACE VIEW onecom_mapping_view AS
SELECT 
    om.id,
    om.onecom_extension,
    om.onecom_phone,
    om.mapping_type,
    om.employee_id,
    om.employee_name,
    te.display_name as actual_employee_name,
    te.phone_ext as employee_phone_ext,
    om.is_active,
    om.created_at,
    om.updated_at
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
WHERE om.is_active = TRUE;

-- Example queries:
-- Find employee by extension: SELECT * FROM onecom_employee_mapping WHERE onecom_extension = '849-decker';
-- Find employee by phone: SELECT * FROM onecom_employee_mapping WHERE onecom_phone = '0526945577';
-- View all mappings: SELECT * FROM onecom_mapping_view ORDER BY employee_name;
