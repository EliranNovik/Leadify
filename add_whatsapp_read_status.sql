-- Add read status tracking to whatsapp_messages table
-- This allows tracking which messages have been read by users

-- Add is_read column to whatsapp_messages table
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- Add read_at timestamp column
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

-- Add read_by column to track which user read the message
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS read_by UUID REFERENCES users(id);

-- Create index for better performance on read status queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_is_read ON whatsapp_messages(is_read);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_read_by ON whatsapp_messages(read_by);

-- Update existing messages to be marked as unread
UPDATE whatsapp_messages 
SET is_read = FALSE, read_at = NULL, read_by = NULL 
WHERE is_read IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN whatsapp_messages.is_read IS 'Whether the message has been read by a user';
COMMENT ON COLUMN whatsapp_messages.read_at IS 'Timestamp when the message was read';
COMMENT ON COLUMN whatsapp_messages.read_by IS 'ID of the user who read the message';
