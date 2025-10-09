-- Step 5c: Clean and convert meeting_lawyer_id column only

-- Check current data
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN meeting_lawyer_id IS NULL OR meeting_lawyer_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN meeting_lawyer_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN meeting_lawyer_id::text !~ '^[0-9]+$' AND meeting_lawyer_id IS NOT NULL AND meeting_lawyer_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT meeting_lawyer_id, COUNT(*) as count
FROM leads_lead 
WHERE meeting_lawyer_id IS NOT NULL 
AND meeting_lawyer_id::text != '' 
AND meeting_lawyer_id::text !~ '^[0-9]+$'
GROUP BY meeting_lawyer_id
ORDER BY count DESC
LIMIT 10;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET meeting_lawyer_id = NULL 
WHERE meeting_lawyer_id IS NOT NULL 
AND meeting_lawyer_id::text != '' 
AND meeting_lawyer_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN meeting_lawyer_id TYPE bigint 
USING CASE 
    WHEN meeting_lawyer_id::text = '' OR meeting_lawyer_id IS NULL THEN NULL
    ELSE meeting_lawyer_id::bigint 
END;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'meeting_lawyer_id';
