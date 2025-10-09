-- Insert phone number mappings
-- Replace the employee IDs below with your actual employee IDs

INSERT INTO onecom_employee_mapping (onecom_phone, mapping_type, employee_id, employee_name) VALUES
-- Top phone numbers by call count - UPDATE THE EMPLOYEE IDs:
('0535363155', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 24 calls
('0524104994', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 9 calls
('0584907445', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 9 calls
('0546781309', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 7 calls
('0529118200', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 6 calls
('0586291922', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 6 calls
('0505293163', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0509286571', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0534991918', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'),  -- 5 calls
('0542322447', 'phone', NULL, 'UPDATE_WITH_EMPLOYEE_NAME'); -- 5 calls

-- After inserting, you can update the employee_id and employee_name:
-- UPDATE onecom_employee_mapping SET employee_id = 123, employee_name = 'Actual Employee Name' WHERE onecom_phone = '0535363155';
