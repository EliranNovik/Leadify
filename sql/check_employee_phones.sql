-- Check the phone column in tenants_employee table
SELECT id, display_name, phone_ext, phone FROM tenants_employee 
WHERE phone IS NOT NULL AND phone != '\\N' AND phone != ''
ORDER BY display_name;
