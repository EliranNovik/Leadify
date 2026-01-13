-- Comprehensive diagnostic query to find the source of "boolean = integer" error
-- Run this in Supabase SQL editor and share the results

-- 1. Check all CHECK constraints on leads_lead table
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'c'  -- CHECK constraints
ORDER BY conname;

-- 2. Check all triggers on leads_lead table
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement,
    action_orientation
FROM information_schema.triggers
WHERE event_object_table = 'leads_lead'
ORDER BY trigger_name;

-- 3. Check the exact foreign key constraint definition
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition,
    confrelid::regclass as referenced_table
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'f'  -- Foreign key constraints
AND pg_get_constraintdef(oid) LIKE '%stage%';

-- 4. Check data types of stage column and related columns
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
    (table_name = 'leads_lead' AND column_name = 'stage')
    OR (table_name = 'lead_stages' AND column_name = 'id')
    OR (table_name = 'leads_lead' AND data_type = 'boolean')
)
ORDER BY table_name, column_name;

-- 5. Check if there are any boolean columns that might be compared to stage
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'leads_lead'
AND data_type = 'boolean'
ORDER BY column_name;

-- 6. Get the exact trigger function code
SELECT 
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname LIKE '%stage%'
ORDER BY p.proname;
