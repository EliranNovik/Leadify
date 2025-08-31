-- Check the schema of emails and whatsapp_messages tables
-- This will help us understand the column types and constraints

-- Check emails table schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'emails' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check whatsapp_messages table schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'whatsapp_messages' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if legacy_id columns exist
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('emails', 'whatsapp_messages')
AND table_schema = 'public'
AND column_name IN ('legacy_id', 'client_id', 'lead_id')
ORDER BY table_name, column_name;

-- Check current data in emails table (first 5 rows)
SELECT 
    message_id,
    client_id,
    legacy_id,
    sender_email,
    subject,
    sent_at
FROM emails 
ORDER BY sent_at DESC 
LIMIT 5;

-- Check current data in whatsapp_messages table (first 5 rows)
SELECT 
    id,
    lead_id,
    legacy_id,
    sender_name,
    message,
    sent_at
FROM whatsapp_messages 
ORDER BY sent_at DESC 
LIMIT 5;
