-- Comprehensive phone number mapping for 1com integration
-- This script helps match 1com phone numbers to your employees

-- 1. First, let's see employees with phone numbers
SELECT 'Employees with phone numbers:' as info;
SELECT id, display_name, phone_ext, phone FROM tenants_employee 
WHERE phone IS NOT NULL AND phone != '\\N' AND phone != ''
ORDER BY display_name;

-- 2. Create a mapping table for the top unmapped phone numbers
-- Based on your data, these are the phone numbers with the most calls:
INSERT INTO onecom_employee_mapping (onecom_phone, mapping_type, employee_id, employee_name) VALUES
-- Top phone numbers by call count - YOU NEED TO UPDATE THE EMPLOYEE IDs:
('0535363155', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 24 calls - MOST IMPORTANT
('0524104994', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 9 calls
('0584907445', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 9 calls
('0546781309', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 7 calls
('0529118200', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 6 calls
('0586291922', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 6 calls
('0505293163', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0509286571', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0534991918', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0542322447', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0547210116', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('048665666', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),   -- 4 calls
('0505543628', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 4 calls
('0559120045', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 4 calls
('033765402', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),   -- 3 calls
('0420734880603', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'), -- 3 calls
('0522597501', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 3 calls
('0533919199', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 3 calls
('0543550580', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 3 calls
('0544497795', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME');  -- 3 calls

-- 3. Also insert the extension mappings we found earlier
INSERT INTO onecom_employee_mapping (onecom_extension, mapping_type, employee_id, employee_name) VALUES
-- Extension mappings - YOU NEED TO UPDATE THE EMPLOYEE IDs:
('849-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),
('231-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),
('243-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),
('205-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),
('214-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),
('260-decker', 'extension', NULL, 'UPDATE_WITH_EMPLOYEE_NAME');

-- 4. After inserting, you can update specific mappings like this:
-- Example updates (replace with actual employee IDs and names):
-- UPDATE onecom_employee_mapping SET employee_id = 75, employee_name = 'Eliran' WHERE onecom_phone = '0535363155';
-- UPDATE onecom_employee_mapping SET employee_id = 22, employee_name = 'Adi' WHERE onecom_phone = '0524104994';
-- UPDATE onecom_employee_mapping SET employee_id = 54, employee_name = 'Anna Zh' WHERE onecom_extension = '231-decker';

-- 5. Verify the mappings
SELECT 
    om.onecom_extension,
    om.onecom_phone,
    om.mapping_type,
    om.employee_name as mapped_name,
    te.display_name as actual_employee_name,
    te.phone_ext,
    te.phone,
    om.is_active
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
ORDER BY 
    CASE WHEN om.mapping_type = 'phone' THEN 1 ELSE 2 END,
    om.onecom_phone,
    om.onecom_extension;
