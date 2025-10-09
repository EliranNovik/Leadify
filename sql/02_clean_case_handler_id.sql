-- Step 2: Clean and convert case_handler_id column
-- Run this only after reviewing the data from step 1

-- First, check how many non-numeric values we have
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN case_handler_id IS NULL OR case_handler_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN case_handler_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN case_handler_id::text !~ '^[0-9]+$' AND case_handler_id IS NOT NULL AND case_handler_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT case_handler_id, COUNT(*) as count
FROM leads_lead 
WHERE case_handler_id IS NOT NULL 
AND case_handler_id::text != '' 
AND case_handler_id::text !~ '^[0-9]+$'
GROUP BY case_handler_id
ORDER BY count DESC
LIMIT 20;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET case_handler_id = NULL 
WHERE case_handler_id IS NOT NULL 
AND case_handler_id::text != '' 
AND case_handler_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN case_handler_id TYPE bigint 
USING case_handler_id::bigint;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'case_handler_id';
