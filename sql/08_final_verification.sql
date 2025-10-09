-- Step 8: Final verification
-- Run this to confirm everything is working correctly

-- Check all column types are now bigint
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

-- Test a query that should be fast now
EXPLAIN (ANALYZE, BUFFERS) 
SELECT id, name, cdate 
FROM leads_lead 
WHERE case_handler_id = 75 
AND status = 0 
ORDER BY cdate DESC 
LIMIT 10;

-- Check that foreign keys are working
SELECT 
    COUNT(*) as total_leads_with_case_handler,
    COUNT(CASE WHEN case_handler_id IS NOT NULL THEN 1 END) as leads_with_handler
FROM leads_lead;

-- Show sample of leads with valid case_handler_id
SELECT id, name, case_handler_id, cdate
FROM leads_lead 
WHERE case_handler_id IS NOT NULL 
ORDER BY cdate DESC 
LIMIT 5;
