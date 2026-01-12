-- Count leads in leads_lead table where total_base and total are NULL and stage is 100
SELECT COUNT(*) as count_leads
FROM leads_lead
WHERE 
    total_base IS NULL
    AND total IS NULL
    AND stage = 100;

-- Optional: Get detailed breakdown with sample records
SELECT 
    COUNT(*) as total_count,
    COUNT(CASE WHEN total_base IS NULL AND total IS NULL THEN 1 END) as both_null_count,
    COUNT(CASE WHEN total_base IS NULL AND total IS NOT NULL THEN 1 END) as only_total_base_null,
    COUNT(CASE WHEN total_base IS NOT NULL AND total IS NULL THEN 1 END) as only_total_null,
    COUNT(CASE WHEN total_base IS NOT NULL AND total IS NOT NULL THEN 1 END) as both_not_null
FROM leads_lead
WHERE stage = 100;

-- Optional: View sample records matching the criteria
SELECT 
    id,
    lead_number,
    name,
    stage,
    total_base,
    total,
    currency_id
FROM leads_lead
WHERE 
    total_base IS NULL
    AND total IS NULL
    AND stage = 100
LIMIT 50;
