-- Diagnostic query to check the current data types of ID columns
-- Run this to verify if the migration was successful

SELECT 
    table_name,
    column_name,
    data_type,
    numeric_precision,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('leads_contact', 'lead_leadcontact', 'leads_lead')
  AND column_name IN ('id', 'contact_id', 'lead_id', 'newlead_id')
ORDER BY table_name, column_name;

-- Also check the current max values to see if we're near the integer limit
SELECT 
    'leads_contact' as table_name,
    MAX(id) as max_id,
    CASE 
        WHEN MAX(id) > 2147483647 THEN 'OVERFLOW RISK - needs bigint'
        WHEN MAX(id) > 2000000000 THEN 'WARNING - approaching limit'
        ELSE 'OK'
    END as status
FROM leads_contact
UNION ALL
SELECT 
    'lead_leadcontact' as table_name,
    MAX(id) as max_id,
    CASE 
        WHEN MAX(id) > 2147483647 THEN 'OVERFLOW RISK - needs bigint'
        WHEN MAX(id) > 2000000000 THEN 'WARNING - approaching limit'
        ELSE 'OK'
    END as status
FROM lead_leadcontact
UNION ALL
SELECT 
    'leads_lead' as table_name,
    MAX(id) as max_id,
    CASE 
        WHEN MAX(id) > 2147483647 THEN 'OVERFLOW RISK - needs bigint'
        WHEN MAX(id) > 2000000000 THEN 'WARNING - approaching limit'
        ELSE 'OK'
    END as status
FROM leads_lead;

