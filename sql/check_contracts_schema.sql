-- Check contracts table schema and constraints
-- This will help us understand if there are any NOT NULL constraints causing issues

-- Check table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name IN ('client_id', 'legacy_id')
ORDER BY column_name;

-- Check constraints
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'contracts'::regclass
AND contype IN ('c', 'n'); -- 'c' = check, 'n' = not null

-- Check if client_id has NOT NULL constraint
SELECT 
    column_name,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name = 'client_id';

-- Check if legacy_id has NOT NULL constraint
SELECT 
    column_name,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name = 'legacy_id';
