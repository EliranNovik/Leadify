-- Management queries for onecom_employee_mapping table

-- 1. VIEW ALL CURRENT MAPPINGS
SELECT 
    om.id,
    om.onecom_extension,
    om.onecom_phone,
    om.mapping_type,
    om.employee_name,
    te.display_name as actual_employee_name,
    te.phone_ext as employee_phone_ext,
    om.is_active,
    om.created_at
FROM onecom_employee_mapping om
LEFT JOIN tenants_employee te ON om.employee_id = te.id
ORDER BY om.employee_name, om.mapping_type;

-- 2. ADD NEW EXTENSION MAPPING
-- INSERT INTO onecom_employee_mapping (onecom_extension, mapping_type, employee_id, employee_name) 
-- VALUES ('NEW_EXTENSION', 'extension', EMPLOYEE_ID, 'EMPLOYEE_NAME');

-- 3. ADD NEW PHONE MAPPING
-- INSERT INTO onecom_employee_mapping (onecom_phone, mapping_type, employee_id, employee_name) 
-- VALUES ('NEW_PHONE', 'phone', EMPLOYEE_ID, 'EMPLOYEE_NAME');

-- 4. UPDATE EXISTING MAPPING
-- UPDATE onecom_employee_mapping 
-- SET employee_id = NEW_EMPLOYEE_ID, employee_name = 'NEW_NAME', updated_at = NOW()
-- WHERE onecom_extension = 'EXTENSION_TO_UPDATE';

-- 5. DEACTIVATE MAPPING (soft delete)
-- UPDATE onecom_employee_mapping 
-- SET is_active = FALSE, updated_at = NOW()
-- WHERE id = MAPPING_ID;

-- 6. FIND UNMAPPED EXTENSIONS FROM CALL LOGS
SELECT DISTINCT 
    source as unmapped_extension,
    COUNT(*) as call_count,
    MIN(cdate) as first_call,
    MAX(cdate) as last_call
FROM call_logs 
WHERE source IS NOT NULL 
    AND source != ''
    AND source NOT IN (
        SELECT COALESCE(onecom_extension, '') FROM onecom_employee_mapping 
        WHERE onecom_extension IS NOT NULL AND is_active = TRUE
    )
    AND cdate >= NOW() - INTERVAL '30 days'
GROUP BY source
ORDER BY call_count DESC
LIMIT 20;

-- 7. FIND UNMAPPED PHONE NUMBERS FROM CALL LOGS
SELECT DISTINCT 
    source as unmapped_phone,
    COUNT(*) as call_count,
    MIN(cdate) as first_call,
    MAX(cdate) as last_call
FROM call_logs 
WHERE source IS NOT NULL 
    AND source != ''
    AND source ~ '^[0-9]+$'  -- Only numeric phone numbers
    AND source NOT IN (
        SELECT COALESCE(onecom_phone, '') FROM onecom_employee_mapping 
        WHERE onecom_phone IS NOT NULL AND is_active = TRUE
    )
    AND cdate >= NOW() - INTERVAL '30 days'
GROUP BY source
ORDER BY call_count DESC
LIMIT 20;

-- 8. CHECK MAPPING STATISTICS
SELECT 
    'Total Mappings' as metric,
    COUNT(*) as count
FROM onecom_employee_mapping
WHERE is_active = TRUE

UNION ALL

SELECT 
    'Extension Mappings' as metric,
    COUNT(*) as count
FROM onecom_employee_mapping
WHERE is_active = TRUE AND mapping_type = 'extension'

UNION ALL

SELECT 
    'Phone Mappings' as metric,
    COUNT(*) as count
FROM onecom_employee_mapping
WHERE is_active = TRUE AND mapping_type = 'phone'

UNION ALL

SELECT 
    'Mapped Call Logs (Last 7 days)' as metric,
    COUNT(*) as count
FROM call_logs cl
INNER JOIN onecom_employee_mapping om ON (
    (om.onecom_extension = cl.source AND om.mapping_type = 'extension') OR
    (om.onecom_phone = cl.source AND om.mapping_type = 'phone')
)
WHERE cl.cdate >= NOW() - INTERVAL '7 days'
    AND om.is_active = TRUE;

-- 9. FIND CALLS WITH EMPLOYEE MAPPING
SELECT 
    cl.id,
    cl.cdate,
    cl.source,
    cl.destination,
    cl.direction,
    cl.duration,
    om.mapping_type,
    om.employee_name,
    te.display_name as actual_employee_name
FROM call_logs cl
INNER JOIN onecom_employee_mapping om ON (
    (om.onecom_extension = cl.source AND om.mapping_type = 'extension') OR
    (om.onecom_phone = cl.source AND om.mapping_type = 'phone')
)
LEFT JOIN tenants_employee te ON om.employee_id = te.id
WHERE om.is_active = TRUE
    AND cl.cdate >= NOW() - INTERVAL '7 days'
ORDER BY cl.cdate DESC
LIMIT 10;
