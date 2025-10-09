-- Clean sample data for onecom_employee_mapping table
-- This file provides examples - you need to update with your actual employee IDs

-- First, let's see what employees we have available
SELECT id, display_name, phone_ext FROM tenants_employee ORDER BY display_name;

-- Example INSERT statements for extensions (UPDATE THESE WITH REAL EMPLOYEE IDs):
-- Uncomment and update the employee IDs below:

-- INSERT INTO onecom_employee_mapping (onecom_extension, mapping_type, employee_id, employee_name) VALUES
-- ('849-decker', 'extension', 1, 'John Doe'),
-- ('231-decker', 'extension', 2, 'Jane Smith'),
-- ('243-decker', 'extension', 3, 'Bob Johnson'),
-- ('205-decker', 'extension', 4, 'Alice Wilson'),
-- ('214-decker', 'extension', 5, 'Charlie Brown'),
-- ('260-decker', 'extension', 6, 'David Miller');

-- Example INSERT statements for phone numbers (UPDATE THESE WITH REAL EMPLOYEE IDs):
-- Uncomment and update the employee IDs below:

-- INSERT INTO onecom_employee_mapping (onecom_phone, mapping_type, employee_id, employee_name) VALUES
-- ('0526945577', 'phone', 7, 'Emma Davis'),
-- ('0536223118', 'phone', 8, 'Frank Wilson'),
-- ('0557720736', 'phone', 9, 'Grace Taylor'),
-- ('0527393737', 'phone', 10, 'Henry Anderson');

-- Query to check current mappings (after inserting data)
SELECT 
    om.onecom_extension,
    om.onecom_phone,
    om.mapping_type,
    om.employee_name,
    te.display_name as actual_employee_name,
    te.phone_ext as employee_phone_ext
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
ORDER BY om.employee_name;

-- Query to find unmapped extensions from recent call logs
SELECT DISTINCT 
    source as unmapped_extension,
    COUNT(*) as call_count
FROM call_logs 
WHERE source IS NOT NULL 
    AND source != ''
    AND source NOT IN (
        SELECT COALESCE(onecom_extension, '') FROM onecom_employee_mapping 
        WHERE onecom_extension IS NOT NULL
    )
    AND cdate >= NOW() - INTERVAL '7 days'
GROUP BY source
ORDER BY call_count DESC
LIMIT 20;

-- Query to find unmapped phone numbers from recent call logs
SELECT DISTINCT 
    source as unmapped_phone,
    COUNT(*) as call_count
FROM call_logs 
WHERE source IS NOT NULL 
    AND source != ''
    AND source ~ '^[0-9]+$'  -- Only numeric phone numbers
    AND source NOT IN (
        SELECT COALESCE(onecom_phone, '') FROM onecom_employee_mapping 
        WHERE onecom_phone IS NOT NULL
    )
    AND cdate >= NOW() - INTERVAL '7 days'
GROUP BY source
ORDER BY call_count DESC
LIMIT 20;
