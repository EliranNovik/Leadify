-- Step 1: Check current data types and sample values
-- Run this first to see what we're working with

-- Check current column types
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN (
    'case_handler_id', 
    'expert_id', 
    'closer_id', 
    'meeting_scheduler_id', 
    'meeting_manager_id', 
    'meeting_lawyer_id', 
    'exclusive_handler_id', 
    'anchor_id'
)
ORDER BY column_name;

-- Check sample values for case_handler_id
SELECT 'case_handler_id samples:' as info;
SELECT DISTINCT case_handler_id, COUNT(*) as count
FROM leads_lead 
WHERE case_handler_id IS NOT NULL 
AND case_handler_id != '' 
GROUP BY case_handler_id
ORDER BY count DESC
LIMIT 10;

-- Check sample values for expert_id
SELECT 'expert_id samples:' as info;
SELECT DISTINCT expert_id, COUNT(*) as count
FROM leads_lead 
WHERE expert_id IS NOT NULL 
AND expert_id != '' 
GROUP BY expert_id
ORDER BY count DESC
LIMIT 10;

-- Check sample values for closer_id
SELECT 'closer_id samples:' as info;
SELECT DISTINCT closer_id, COUNT(*) as count
FROM leads_lead 
WHERE closer_id IS NOT NULL 
AND closer_id != '' 
GROUP BY closer_id
ORDER BY count DESC
LIMIT 10;
