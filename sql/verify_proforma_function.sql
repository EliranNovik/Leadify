-- Verify that create_proforma_with_rows function has the creator_id parameter
-- Run this query to check the function signature

SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as function_arguments,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'create_proforma_with_rows'
AND n.nspname = 'public';

-- Check if creator_id parameter exists in the function
-- If the function has been updated, you should see 'p_creator_id numeric' in the function_arguments column
