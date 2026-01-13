-- Find the exact source of "boolean = integer" error
-- Run this and share ALL results

-- 1. Check what triggers fire on UPDATE of leads_lead
SELECT 
    t.trigger_name,
    t.event_manipulation,
    t.action_timing,
    t.action_statement,
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_code
FROM information_schema.triggers t
JOIN pg_proc p ON t.action_statement LIKE '%' || p.proname || '%'
WHERE t.event_object_table = 'leads_lead'
AND t.event_manipulation = 'UPDATE'
ORDER BY t.trigger_name;

-- 2. Check the exact foreign key constraint definition
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition,
    confrelid::regclass as referenced_table
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'f'
AND pg_get_constraintdef(oid) LIKE '%stage%';

-- 3. Check data type of lead_stages.id
SELECT 
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'lead_stages'
AND column_name = 'id';

-- 4. Try to manually update stage 60 for lead 6 to see the exact error
-- (This will help us see the full error message)
DO $$
BEGIN
    UPDATE leads_lead SET stage = 60::BIGINT WHERE id = 6;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %, SQLSTATE: %', SQLERRM, SQLSTATE;
END $$;
