-- Step 5d: Clean and convert exclusive_handler_id column only

-- Check current data
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN exclusive_handler_id IS NULL OR exclusive_handler_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN exclusive_handler_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN exclusive_handler_id::text !~ '^[0-9]+$' AND exclusive_handler_id IS NOT NULL AND exclusive_handler_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT exclusive_handler_id, COUNT(*) as count
FROM leads_lead 
WHERE exclusive_handler_id IS NOT NULL 
AND exclusive_handler_id::text != '' 
AND exclusive_handler_id::text !~ '^[0-9]+$'
GROUP BY exclusive_handler_id
ORDER BY count DESC
LIMIT 10;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET exclusive_handler_id = NULL 
WHERE exclusive_handler_id IS NOT NULL 
AND exclusive_handler_id::text != '' 
AND exclusive_handler_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN exclusive_handler_id TYPE bigint 
USING CASE 
    WHEN exclusive_handler_id::text = '' OR exclusive_handler_id IS NULL THEN NULL
    ELSE exclusive_handler_id::bigint 
END;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'exclusive_handler_id';
