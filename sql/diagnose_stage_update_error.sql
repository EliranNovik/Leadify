-- Diagnostic query to find the source of "boolean = integer" error
-- Run this to check for constraints and triggers on leads_lead.stage

-- Check for CHECK constraints on leads_lead table
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'c'  -- CHECK constraints
AND pg_get_constraintdef(oid) LIKE '%stage%';

-- Check for triggers on leads_lead table
SELECT 
    trigger_name,
    event_manipulation,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'leads_lead'
AND event_manipulation = 'UPDATE';

-- Check the data type of leads_lead.stage
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'leads_lead'
AND column_name = 'stage';

-- Check for foreign key constraints on stage
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'f'  -- Foreign key constraints
AND pg_get_constraintdef(oid) LIKE '%stage%';
