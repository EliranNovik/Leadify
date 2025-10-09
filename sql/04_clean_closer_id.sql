-- Step 4: Clean and convert closer_id column

-- Check how many non-numeric values we have
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN closer_id IS NULL OR closer_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN closer_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN closer_id::text !~ '^[0-9]+$' AND closer_id IS NOT NULL AND closer_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT closer_id, COUNT(*) as count
FROM leads_lead 
WHERE closer_id IS NOT NULL 
AND closer_id::text != '' 
AND closer_id::text !~ '^[0-9]+$'
GROUP BY closer_id
ORDER BY count DESC
LIMIT 20;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET closer_id = NULL 
WHERE closer_id IS NOT NULL 
AND closer_id::text != '' 
AND closer_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN closer_id TYPE bigint 
USING closer_id::bigint;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'closer_id';
