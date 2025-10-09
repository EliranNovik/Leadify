-- Find potential matches between 1com phone numbers and employee phone numbers
-- This helps identify which employees might match which 1com phone numbers

-- Get the top unmapped phone numbers from call logs
WITH unmapped_phones AS (
    SELECT DISTINCT 
        source as onecom_phone,
        COUNT(*) as call_count
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
    LIMIT 20
),
-- Get employees with phone numbers
employees_with_phones AS (
    SELECT id, display_name, phone_ext, phone
    FROM tenants_employee 
    WHERE phone IS NOT NULL AND phone != '\\N' AND phone != ''
)

-- Show potential matches (exact matches first, then partial matches)
SELECT 
    'EXACT MATCHES' as match_type,
    up.onecom_phone,
    up.call_count,
    ewp.display_name,
    ewp.id as employee_id,
    ewp.phone as employee_phone,
    ewp.phone_ext
FROM unmapped_phones up
INNER JOIN employees_with_phones ewp ON up.onecom_phone = ewp.phone

UNION ALL

SELECT 
    'PARTIAL MATCHES (last 7 digits)' as match_type,
    up.onecom_phone,
    up.call_count,
    ewp.display_name,
    ewp.id as employee_id,
    ewp.phone as employee_phone,
    ewp.phone_ext
FROM unmapped_phones up
INNER JOIN employees_with_phones ewp ON RIGHT(up.onecom_phone, 7) = RIGHT(ewp.phone, 7)
WHERE up.onecom_phone NOT IN (
    SELECT up2.onecom_phone FROM unmapped_phones up2
    INNER JOIN employees_with_phones ewp2 ON up2.onecom_phone = ewp2.phone
)

ORDER BY match_type, call_count DESC;
