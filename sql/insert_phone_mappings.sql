-- Insert phone number mappings for the unmapped phone numbers you found
-- You need to update the employee_id values with your actual employee IDs

-- First, let's see your employees to choose the right IDs
SELECT id, display_name, phone_ext FROM tenants_employee ORDER BY display_name;

-- Insert the phone number mappings (UPDATE THE EMPLOYEE IDs BELOW)
-- Based on your unmapped phone numbers with highest call counts:

INSERT INTO onecom_employee_mapping (onecom_phone, mapping_type, employee_id, employee_name) VALUES
-- Update these employee_id values with your actual employee IDs:
('0535363155', 'phone', 1, 'Employee Name 1'),  -- 24 calls
('0524104994', 'phone', 2, 'Employee Name 2'),  -- 9 calls
('0584907445', 'phone', 3, 'Employee Name 3'),  -- 9 calls
('0546781309', 'phone', 4, 'Employee Name 4'),  -- 7 calls
('0529118200', 'phone', 5, 'Employee Name 5'),  -- 6 calls
('0586291922', 'phone', 6, 'Employee Name 6'),  -- 6 calls
('0505293163', 'phone', 7, 'Employee Name 7'),  -- 5 calls
('0509286571', 'phone', 8, 'Employee Name 8'),  -- 5 calls
('0534991918', 'phone', 9, 'Employee Name 9'),  -- 5 calls
('0542322447', 'phone', 10, 'Employee Name 10'), -- 5 calls
('0547210116', 'phone', 11, 'Employee Name 11'), -- 5 calls
('048665666', 'phone', 12, 'Employee Name 12'),  -- 4 calls
('0505543628', 'phone', 13, 'Employee Name 13'), -- 4 calls
('0559120045', 'phone', 14, 'Employee Name 14'), -- 4 calls
('033765402', 'phone', 15, 'Employee Name 15'),  -- 3 calls
('0420734880603', 'phone', 16, 'Employee Name 16'), -- 3 calls
('0522597501', 'phone', 17, 'Employee Name 17'), -- 3 calls
('0533919199', 'phone', 18, 'Employee Name 18'), -- 3 calls
('0543550580', 'phone', 19, 'Employee Name 19'), -- 3 calls
('0544497795', 'phone', 20, 'Employee Name 20'); -- 3 calls

-- Query to verify the mappings were inserted correctly
SELECT 
    om.onecom_phone,
    om.mapping_type,
    om.employee_name,
    te.display_name as actual_employee_name,
    om.is_active
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
WHERE om.mapping_type = 'phone'
ORDER BY om.onecom_phone;

-- Check how many call logs will now be mapped
SELECT COUNT(*) as newly_mappable_calls
FROM call_logs cl
INNER JOIN onecom_employee_mapping om ON om.onecom_phone = cl.source
WHERE om.mapping_type = 'phone' 
    AND om.is_active = TRUE
    AND cl.cdate >= NOW() - INTERVAL '30 days';
