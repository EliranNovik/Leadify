-- Step 3: Handle view dependencies before converting expert_id
-- This script handles the combined_leads_view that depends on expert_id

-- First, let's see what views depend on our columns
SELECT 
    schemaname,
    viewname,
    definition
FROM pg_views 
WHERE viewname LIKE '%lead%' 
AND definition LIKE '%expert_id%';

-- Also check for any other dependencies
SELECT 
    n.nspname as schema_name,
    c.relname as table_name,
    a.attname as column_name,
    t.typname as data_type,
    CASE 
        WHEN c.relkind = 'v' THEN 'view'
        WHEN c.relkind = 'r' THEN 'table'
        ELSE 'other'
    END as object_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
JOIN pg_type t ON t.oid = a.atttypid
WHERE a.attname IN (
    'expert_id', 
    'case_handler_id', 
    'closer_id', 
    'meeting_scheduler_id', 
    'meeting_manager_id', 
    'meeting_lawyer_id', 
    'exclusive_handler_id', 
    'anchor_id'
)
AND n.nspname = 'public'
ORDER BY c.relname, a.attname;

-- Get the current definition of combined_leads_view
SELECT 
    schemaname,
    viewname,
    definition
FROM pg_views 
WHERE viewname = 'combined_leads_view';

-- Note: We'll need to drop the view, convert the columns, then recreate it
-- The actual DROP and CREATE statements will need to be run separately
-- after we see what the view definition looks like
