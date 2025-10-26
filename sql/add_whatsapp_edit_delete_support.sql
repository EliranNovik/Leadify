-- Add columns to whatsapp_messages table to support edit and delete features
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_is_edited ON whatsapp_messages(is_edited);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_is_deleted ON whatsapp_messages(is_deleted);
