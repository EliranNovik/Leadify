-- Fix NOT NULL constraints for legacy lead support
-- This allows client_id and lead_id to be null for legacy leads

-- 1. Make client_id nullable in emails table
ALTER TABLE public.emails 
ALTER COLUMN client_id DROP NOT NULL;

-- 2. Make lead_id nullable in whatsapp_messages table  
ALTER TABLE public.whatsapp_messages 
ALTER COLUMN lead_id DROP NOT NULL;

-- 3. Verify the changes
SELECT 
    table_name,
    column_name,
    is_nullable,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('emails', 'whatsapp_messages')
AND table_schema = 'public'
AND column_name IN ('client_id', 'lead_id', 'legacy_id')
ORDER BY table_name, column_name;

-- 4. Test insert for legacy lead (optional - uncomment to test)
-- INSERT INTO public.emails (
--     message_id,
--     client_id,
--     legacy_id,
--     sender_name,
--     sender_email,
--     recipient_list,
--     subject,
--     body_preview,
--     sent_at,
--     direction
-- ) VALUES (
--     'test_message_id_' || EXTRACT(EPOCH FROM NOW()),
--     NULL,
--     129152,
--     'Test User',
--     'test@example.com',
--     'client@example.com',
--     'Test Subject',
--     'Test body',
--     NOW(),
--     'outgoing'
-- );
