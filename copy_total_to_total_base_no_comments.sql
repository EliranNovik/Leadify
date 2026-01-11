SELECT 
    COUNT(*) as rows_to_update,
    COUNT(CASE WHEN total IS NOT NULL THEN 1 END) as rows_with_total_value,
    COUNT(CASE WHEN total IS NULL THEN 1 END) as rows_with_null_total
FROM leads_lead
WHERE total_base IS NULL;

UPDATE leads_lead
SET total_base = total
WHERE total_base IS NULL
  AND total IS NOT NULL;

SELECT 
    COUNT(*) as remaining_null_total_base
FROM leads_lead
WHERE total_base IS NULL;
