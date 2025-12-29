-- Check unique constraints and indexes on leads_leadstage table
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_leadstage'::regclass
ORDER BY contype, conname;

-- Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'leads_leadstage'
ORDER BY indexname;

-- Check table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'leads_leadstage'
AND table_schema = 'public'
ORDER BY ordinal_position;
