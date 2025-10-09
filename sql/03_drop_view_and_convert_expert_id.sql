-- Step 3: Drop view and convert expert_id column
-- Run this after checking the view definition

-- IMPORTANT: Replace this with the actual view definition from the previous query
-- For now, we'll drop the view without recreating it
-- You'll need to recreate it later with the proper definition

-- Drop the view that's blocking our column conversion
DROP VIEW IF EXISTS combined_leads_view;

-- Now we can convert expert_id column
-- Check how many non-numeric values we have
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN expert_id IS NULL OR expert_id::text = '' THEN 1 END) as empty_values,
    COUNT(CASE WHEN expert_id::text ~ '^[0-9]+$' THEN 1 END) as numeric_values,
    COUNT(CASE WHEN expert_id::text !~ '^[0-9]+$' AND expert_id IS NOT NULL AND expert_id::text != '' THEN 1 END) as non_numeric_values
FROM leads_lead;

-- Show non-numeric values that will be cleaned
SELECT DISTINCT expert_id, COUNT(*) as count
FROM leads_lead 
WHERE expert_id IS NOT NULL 
AND expert_id::text != '' 
AND expert_id::text !~ '^[0-9]+$'
GROUP BY expert_id
ORDER BY count DESC
LIMIT 20;

-- Clean non-numeric values (set to NULL)
UPDATE leads_lead 
SET expert_id = NULL 
WHERE expert_id IS NOT NULL 
AND expert_id::text != '' 
AND expert_id::text !~ '^[0-9]+$';

-- Convert to bigint
ALTER TABLE leads_lead 
ALTER COLUMN expert_id TYPE bigint 
USING expert_id::bigint;

-- Verify the conversion
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'expert_id';

-- Note: You'll need to recreate combined_leads_view later
-- Run the view definition query first to get the original definition
