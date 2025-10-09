-- Step 5: Clean and convert remaining role columns

-- Clean and convert meeting_scheduler_id
UPDATE leads_lead 
SET meeting_scheduler_id = NULL 
WHERE meeting_scheduler_id IS NOT NULL 
AND meeting_scheduler_id::text != '' 
AND meeting_scheduler_id::text !~ '^[0-9]+$';

ALTER TABLE leads_lead 
ALTER COLUMN meeting_scheduler_id TYPE bigint 
USING meeting_scheduler_id::bigint;

-- Clean and convert meeting_manager_id
UPDATE leads_lead 
SET meeting_manager_id = NULL 
WHERE meeting_manager_id IS NOT NULL 
AND meeting_manager_id::text != '' 
AND meeting_manager_id::text !~ '^[0-9]+$';

ALTER TABLE leads_lead 
ALTER COLUMN meeting_manager_id TYPE bigint 
USING meeting_manager_id::bigint;

-- Clean and convert meeting_lawyer_id
UPDATE leads_lead 
SET meeting_lawyer_id = NULL 
WHERE meeting_lawyer_id IS NOT NULL 
AND meeting_lawyer_id::text != '' 
AND meeting_lawyer_id::text !~ '^[0-9]+$';

ALTER TABLE leads_lead 
ALTER COLUMN meeting_lawyer_id TYPE bigint 
USING meeting_lawyer_id::bigint;

-- Clean and convert exclusive_handler_id
UPDATE leads_lead 
SET exclusive_handler_id = NULL 
WHERE exclusive_handler_id IS NOT NULL 
AND exclusive_handler_id::text != '' 
AND exclusive_handler_id::text !~ '^[0-9]+$';

ALTER TABLE leads_lead 
ALTER COLUMN exclusive_handler_id TYPE bigint 
USING exclusive_handler_id::bigint;

-- Clean and convert anchor_id
UPDATE leads_lead 
SET anchor_id = NULL 
WHERE anchor_id IS NOT NULL 
AND anchor_id::text != '' 
AND anchor_id::text !~ '^[0-9]+$';

ALTER TABLE leads_lead 
ALTER COLUMN anchor_id TYPE bigint 
USING anchor_id::bigint;

-- Verify all conversions
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
