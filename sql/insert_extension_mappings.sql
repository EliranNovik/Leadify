-- Insert extension mappings for the non-phone extensions found in call logs
-- You need to update the employee_id values with your actual employee IDs

-- First, let's see your employees to choose the right IDs
SELECT id, display_name, phone_ext FROM tenants_employee ORDER BY display_name;

-- Insert the extension mappings (UPDATE THE EMPLOYEE IDs BELOW)
-- Based on the non-phone extensions we found earlier:

INSERT INTO onecom_employee_mapping (onecom_extension, mapping_type, employee_id, employee_name) VALUES
-- Update these employee_id values with your actual employee IDs:
('849-decker', 'extension', 1, 'Employee Name 1'),
('231-decker', 'extension', 2, 'Employee Name 2'),
('243-decker', 'extension', 3, 'Employee Name 3'),
('205-decker', 'extension', 4, 'Employee Name 4'),
('214-decker', 'extension', 5, 'Employee Name 5'),
('260-decker', 'extension', 6, 'Employee Name 6');

-- Query to verify the mappings were inserted correctly
SELECT 
    om.onecom_extension,
    om.mapping_type,
    om.employee_name,
    te.display_name as actual_employee_name,
    om.is_active
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
WHERE om.mapping_type = 'extension'
ORDER BY om.onecom_extension;

-- Check how many call logs will now be mapped with extensions
SELECT COUNT(*) as newly_mappable_calls_with_extensions
FROM call_logs cl
INNER JOIN onecom_employee_mapping om ON om.onecom_extension = cl.source
WHERE om.mapping_type = 'extension' 
    AND om.is_active = TRUE
    AND cl.cdate >= NOW() - INTERVAL '30 days';
