-- Add phone_number column to whatsapp_messages table
-- This column will store the original phone number from WhatsApp webhook

ALTER TABLE whatsapp_messages 
ADD COLUMN phone_number TEXT;

-- Add an index on phone_number for better query performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_number 
ON whatsapp_messages(phone_number);

-- Add a comment to document the column purpose
COMMENT ON COLUMN whatsapp_messages.phone_number IS 'Original phone number from WhatsApp webhook (from field)';

-- Optional: Update existing records to extract phone numbers from sender_name if possible
-- This is a one-time migration for existing data
UPDATE whatsapp_messages 
SET phone_number = CASE 
  WHEN sender_name ~ '^(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})$' THEN sender_name
  WHEN sender_name ~ '(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})' THEN 
    (regexp_match(sender_name, '(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})'))[1]
  ELSE NULL
END
WHERE phone_number IS NULL 
  AND direction = 'in' 
  AND sender_name IS NOT NULL;
