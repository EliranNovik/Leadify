-- Step 5f: Verify all role column conversions
-- Run this after converting all individual columns

-- Check that all role columns are now bigint
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

-- Show sample data to confirm conversions worked
SELECT 
    id, 
    name, 
    case_handler_id, 
    expert_id, 
    closer_id, 
    meeting_scheduler_id, 
    meeting_manager_id,
    cdate
FROM leads_lead 
WHERE case_handler_id IS NOT NULL 
OR expert_id IS NOT NULL 
OR closer_id IS NOT NULL
ORDER BY cdate DESC 
LIMIT 10;
