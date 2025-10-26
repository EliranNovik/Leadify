-- Add button_response and list_response message types to whatsapp_messages table
-- This allows storing WhatsApp template button clicks and interactive list selections

-- First, drop the existing check constraint
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_message_type_check;

-- Add the new constraint with button_response and list_response included
ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_message_type_check 
CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'button_response', 'list_response'));

-- Verify the constraint
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'whatsapp_messages_message_type_check';
