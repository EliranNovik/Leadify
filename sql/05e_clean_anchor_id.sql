-- Step 5e: Clean and convert anchor_id column only

-- Check current data
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN anchor_id IS NULL OR anchor_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN anchor_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN anchor_id::text !~ '^[0-9]+$' AND anchor_id IS NOT NULL AND anchor_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT anchor_id, COUNT(*) as count
FROM leads_lead 
WHERE anchor_id IS NOT NULL 
AND anchor_id::text != '' 
AND anchor_id::text !~ '^[0-9]+$'
GROUP BY anchor_id
ORDER BY count DESC
LIMIT 10;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET anchor_id = NULL 
WHERE anchor_id IS NOT NULL 
AND anchor_id::text != '' 
AND anchor_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN anchor_id TYPE bigint 
USING CASE 
    WHEN anchor_id::text = '' OR anchor_id IS NULL THEN NULL
    ELSE anchor_id::bigint 
END;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'anchor_id';
