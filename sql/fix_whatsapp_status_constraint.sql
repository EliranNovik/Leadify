-- Fix whatsapp_status check constraint to include 'pending' status
-- Drop the existing constraint
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_whatsapp_status_check;

-- Add the new constraint with 'pending' included
ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_whatsapp_status_check 
CHECK (whatsapp_status IN ('pending', 'sent', 'delivered', 'read', 'failed'));

-- Verify the constraint
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'whatsapp_messages_whatsapp_status_check';
