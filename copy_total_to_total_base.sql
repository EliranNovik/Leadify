/* Step 1: Count how many rows have total_base as NULL */
SELECT 
    COUNT(*) as rows_to_update,
    COUNT(CASE WHEN total IS NOT NULL THEN 1 END) as rows_with_total_value,
    COUNT(CASE WHEN total IS NULL THEN 1 END) as rows_with_null_total
FROM leads_lead
WHERE total_base IS NULL;

/* Step 2: Update total_base with total value where total_base is NULL */
UPDATE leads_lead
SET total_base = total
WHERE total_base IS NULL
  AND total IS NOT NULL;

/* Step 3: Verify the update - count remaining NULL values */
SELECT 
    COUNT(*) as remaining_null_total_base
FROM leads_lead
WHERE total_base IS NULL;
