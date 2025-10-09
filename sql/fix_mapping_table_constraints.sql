-- Fix the onecom_employee_mapping table constraints
-- The issue is that onecom_extension and onecom_phone both have NOT NULL constraints
-- But we need to allow one to be NULL when the other is populated

-- Drop the existing constraints
ALTER TABLE onecom_employee_mapping 
ALTER COLUMN onecom_extension DROP NOT NULL;

ALTER TABLE onecom_employee_mapping 
ALTER COLUMN onecom_phone DROP NOT NULL;

-- Update the check constraint to be more flexible
ALTER TABLE onecom_employee_mapping 
DROP CONSTRAINT IF EXISTS chk_has_value;

-- Add a better check constraint that ensures at least one of extension or phone is provided
ALTER TABLE onecom_employee_mapping 
ADD CONSTRAINT chk_has_extension_or_phone 
CHECK (
    (onecom_extension IS NOT NULL AND onecom_extension != '') OR
    (onecom_phone IS NOT NULL AND onecom_phone != '')
);

-- Update the comments
COMMENT ON COLUMN onecom_employee_mapping.onecom_extension IS '1com extension number (e.g., 849-decker, 231-decker) - can be NULL if onecom_phone is provided';
COMMENT ON COLUMN onecom_employee_mapping.onecom_phone IS '1com phone number (e.g., 0526945577, 0536223118) - can be NULL if onecom_extension is provided';

-- Verify the changes
SELECT 
    column_name, 
    is_nullable, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'onecom_employee_mapping' 
    AND column_name IN ('onecom_extension', 'onecom_phone')
ORDER BY column_name;
