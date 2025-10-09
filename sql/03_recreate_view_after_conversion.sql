-- Step 3b: Recreate the combined_leads_view after column conversion
-- Run this after converting all columns to bigint

-- IMPORTANT: You need to replace this with the actual view definition
-- Get the original definition by running:
-- SELECT definition FROM pg_views WHERE viewname = 'combined_leads_view';

-- Example view recreation (replace with actual definition):
/*
CREATE VIEW combined_leads_view AS
SELECT 
    id,
    name,
    expert_id,  -- Now this will be bigint
    case_handler_id,  -- Now this will be bigint
    closer_id,  -- Now this will be bigint
    -- ... other columns
FROM leads_lead
WHERE status = 0;
*/

-- To find the original view definition, run this first:
SELECT 
    'CREATE VIEW combined_leads_view AS ' || definition || ';' as recreate_statement
FROM pg_views 
WHERE viewname = 'combined_leads_view';

-- Then copy the output and run it to recreate the view
